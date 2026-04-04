#!/bin/bash
# ==============================================================================
# DNS Control — Validação Operacional da Observabilidade DNS (genérico)
# Executar NO HOST REAL como root
# Compatível com qualquer host Debian/Unbound/nftables/DNS Control
# ==============================================================================

set -uo pipefail

API="${API:-http://127.0.0.1:8000/api}"
TOKEN="${TOKEN:-}"
VIP4="${VIP4:-}"
VIP6="${VIP6:-}"
TIMEOUT_WAIT="${TIMEOUT_WAIT:-15}"
BASELINE_WAIT="${BASELINE_WAIT:-10}"
DNSTAP_SERVICE="${DNSTAP_SERVICE:-dns-control-dnstap}"
DNSTAP_EVENTS_FILE="${DNSTAP_EVENTS_FILE:-/var/lib/dns-control/telemetry/dnstap-events.json}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

ok()   { echo -e "  ${GREEN}✓ $1${NC}"; ((PASS++)); }
fail() { echo -e "  ${RED}✗ $1${NC}"; ((FAIL++)); }
warn() { echo -e "  ${YELLOW}⚠ $1${NC}"; }
skip() { echo -e "  ${BLUE}↷ $1${NC}"; ((SKIP++)); }
header() { echo -e "\n${YELLOW}════ $1 ════${NC}"; }

AUTH_ARGS=()
if [ -n "$TOKEN" ]; then
  AUTH_ARGS=(-H "Authorization: Bearer $TOKEN")
fi

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || {
    fail "Comando obrigatório ausente: $cmd"
    exit 1
  }
}

api_get() {
  local path="$1"
  if [ ${#AUTH_ARGS[@]} -gt 0 ]; then
    curl -sf "${AUTH_ARGS[@]}" "$API$path" 2>/dev/null
  else
    curl -sf "$API$path" 2>/dev/null
  fi
}

json_get() {
  local expr="$1"
  python3 - "$expr" <<'PY'
import json, sys
expr = sys.argv[1]
data = json.load(sys.stdin)

def get_path(obj, path):
    cur = obj
    for p in path.split('.'):
        if isinstance(cur, dict):
            cur = cur.get(p)
        elif isinstance(cur, list):
            try:
                cur = cur[int(p)]
            except (ValueError, IndexError):
                print("")
                return
        else:
            print("")
            return
    if cur is None:
        print("")
    elif isinstance(cur, (dict, list)):
        print(json.dumps(cur))
    else:
        print(cur)

get_path(data, expr)
PY
}

cleanup_nft_timeout_rules() {
  nft list table inet dns_obsv_test >/dev/null 2>&1 && nft delete table inet dns_obsv_test >/dev/null 2>&1 || true
}

trap cleanup_nft_timeout_rules EXIT

discover_vips_from_api() {
  local resp
  resp=$(api_get "/inventory/vips" 2>/dev/null || echo "")
  [ -z "$resp" ] && return 1

  python3 <<'PY' <<<"$resp"
import json, sys, ipaddress
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)

items = []
if isinstance(data, dict):
    for key in ("vips", "items", "intercepted_vips"):
        if key in data and isinstance(data[key], list):
            items = data[key]
            break

vip4 = ""
vip6 = ""

for item in items:
    if isinstance(item, dict):
        candidates = []
        for k in ("vip", "ip", "address", "vip_ip"):
            if k in item:
                candidates.append(item[k])
        for c in candidates:
            try:
                ip = ipaddress.ip_address(str(c))
                if ip.version == 4 and not vip4:
                    vip4 = str(ip)
                elif ip.version == 6 and not vip6:
                    vip6 = str(ip)
            except Exception:
                pass
    elif isinstance(item, str):
        try:
            ip = ipaddress.ip_address(item)
            if ip.version == 4 and not vip4:
                vip4 = str(ip)
            elif ip.version == 6 and not vip6:
                vip6 = str(ip)
        except Exception:
            pass

print(vip4)
print(vip6)
PY
}

discover_vips_from_host() {
  python3 <<'PY'
import json, subprocess, ipaddress, sys

vip4 = ""
vip6 = ""

try:
    out = subprocess.check_output(["ip", "-j", "addr"], text=True)
    data = json.loads(out)
except Exception:
    print("")
    print("")
    sys.exit(0)

for iface in data:
    name = iface.get("ifname", "")
    addrs = iface.get("addr_info", [])
    for a in addrs:
        local = a.get("local")
        fam = a.get("family")
        prefix = a.get("prefixlen")
        if not local:
            continue

        try:
            ip = ipaddress.ip_address(local)
        except Exception:
            continue

        if fam == "inet":
            if ip.is_loopback:
                continue
            # Prefer /32 on lo/dummy that don't look like internal listeners
            if prefix == 32 and name.startswith("lo"):
                if not local.startswith("100."):
                    vip4 = vip4 or local
        elif fam == "inet6":
            if ip.is_loopback or ip.is_link_local:
                continue
            if prefix == 128 and name.startswith("lo"):
                vip6 = vip6 or local

print(vip4)
print(vip6)
PY
}

discover_upstreams() {
  grep -RhoP '^\s*forward-addr:\s*\K\S+' /etc/unbound/unbound*.conf 2>/dev/null | sort -u
}

choose_vips() {
  if [ -z "$VIP4" ] || [ -z "$VIP6" ]; then
    mapfile -t api_vips < <(discover_vips_from_api 2>/dev/null || true)
    [ -z "${VIP4}" ] && VIP4="${api_vips[0]:-}"
    [ -z "${VIP6}" ] && VIP6="${api_vips[1]:-}"
  fi

  if [ -z "$VIP4" ] || [ -z "$VIP6" ]; then
    mapfile -t host_vips < <(discover_vips_from_host)
    [ -z "${VIP4}" ] && VIP4="${host_vips[0]:-}"
    [ -z "${VIP6}" ] && VIP6="${host_vips[1]:-}"
  fi
}

split_upstreams() {
  UPSTREAM4_BLOCKS=()
  UPSTREAM6_BLOCKS=()
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [[ "$line" == *:* ]]; then
      UPSTREAM6_BLOCKS+=("$line")
    else
      UPSTREAM4_BLOCKS+=("$line")
    fi
  done < <(discover_upstreams)
}

# ==============================================================================
header "BLOCO 0 — PRÉ-CHECAGENS"
# ==============================================================================

require_cmd curl
require_cmd dig
require_cmd systemctl
require_cmd ss
require_cmd nft
require_cmd python3
require_cmd journalctl

choose_vips
split_upstreams

echo "  API: $API"
echo "  VIP4 detectado/configurado: ${VIP4:-<nenhum>}"
echo "  VIP6 detectado/configurado: ${VIP6:-<nenhum>}"
echo "  Upstreams IPv4 detectados: ${UPSTREAM4_BLOCKS[*]:-<nenhum>}"
echo "  Upstreams IPv6 detectados: ${UPSTREAM6_BLOCKS[*]:-<nenhum>}"

if systemctl is-active dns-control-api >/dev/null 2>&1; then
  ok "dns-control-api ativo"
else
  fail "dns-control-api inativo"
fi

if [ -n "$VIP4" ]; then
  if dig @"$VIP4" google.com +time=2 +tries=1 +short >/dev/null 2>&1; then
    ok "VIP4 responde DNS"
  else
    warn "VIP4 não respondeu no baseline"
  fi
else
  warn "VIP4 não detectado"
fi

if [ -n "$VIP6" ]; then
  if dig @"$VIP6" google.com AAAA +time=2 +tries=1 +short >/dev/null 2>&1; then
    ok "VIP6 responde DNS"
  else
    warn "VIP6 não respondeu no baseline"
  fi
else
  warn "VIP6 não detectado"
fi

# ==============================================================================
header "BLOCO 1 — DNSTAP ATIVO"
# ==============================================================================

DNSTAP_CONF=$(grep -Rni "dnstap-enable" /etc/unbound 2>/dev/null | head -20 || true)
if echo "$DNSTAP_CONF" | grep -qi "yes"; then
  ok "dnstap-enable: yes encontrado"
  echo "$DNSTAP_CONF" | sed 's/^/    /'
else
  warn "dnstap-enable: yes não encontrado (dnstap pode não estar configurado)"
fi

DNSTAP_SOCK_PATH=$(grep -RhoP 'dnstap-socket-path:\s*\K\S+' /etc/unbound 2>/dev/null | head -1 || true)
if [ -n "$DNSTAP_SOCK_PATH" ]; then
  ok "Socket path configurado: $DNSTAP_SOCK_PATH"
  if [ -S "$DNSTAP_SOCK_PATH" ]; then
    ok "Socket file existe"
  else
    warn "Socket file não existe em $DNSTAP_SOCK_PATH"
  fi
else
  warn "dnstap-socket-path não encontrado na config"
fi

DNSTAP_SOCK=$(ss -lx 2>/dev/null | grep -i "dnstap" || true)
if [ -n "$DNSTAP_SOCK" ]; then
  ok "Socket dnstap ativo (ss)"
  echo "$DNSTAP_SOCK" | sed 's/^/    /'
else
  warn "Socket dnstap não encontrado via ss"
fi

if systemctl is-active "$DNSTAP_SERVICE" >/dev/null 2>&1; then
  ok "$DNSTAP_SERVICE ativo"
  journalctl -u "$DNSTAP_SERVICE" -n 10 --no-pager 2>/dev/null | sed 's/^/    /'
else
  warn "$DNSTAP_SERVICE inativo (fallback será usado)"
fi

DNSTAP_STATUS=$(api_get "/metrics/dns/errors/dnstap/status" || echo '{}')
DNSTAP_ENABLED=$(echo "$DNSTAP_STATUS" | json_get "enabled" 2>/dev/null || echo "")
echo "  API dnstap status: enabled=$DNSTAP_ENABLED"

if [ -f "$DNSTAP_EVENTS_FILE" ]; then
  EVENT_COUNT=$(python3 -c "
import json
try:
    data = json.load(open('$DNSTAP_EVENTS_FILE'))
    events = data if isinstance(data, list) else data.get('events', [])
    print(len(events))
except: print(0)
" 2>/dev/null || echo 0)
  ok "Arquivo de eventos dnstap existe ($EVENT_COUNT eventos)"
else
  warn "Arquivo de eventos dnstap não encontrado: $DNSTAP_EVENTS_FILE"
fi

# ==============================================================================
header "BLOCO 2 — DETECÇÃO DE NXDOMAIN"
# ==============================================================================

if [ -n "$VIP4" ]; then
  BASE_SUMMARY=$(api_get "/metrics/dns/errors/summary?minutes=5" || echo '{}')
  BASE_NXDOMAIN=$(echo "$BASE_SUMMARY" | json_get "rcode_counts.NXDOMAIN" 2>/dev/null || echo 0)
  BASE_NXDOMAIN=${BASE_NXDOMAIN:-0}

  for i in $(seq 1 5); do
    dig "teste-inexistente-${i}-$(date +%s).invalid" @"$VIP4" +time=2 +tries=1 >/dev/null 2>&1 &
  done
  wait
  ok "5 queries NXDOMAIN enviadas"

  echo "  Aguardando ${BASELINE_WAIT}s para coleta..."
  sleep "$BASELINE_WAIT"

  POST_SUMMARY=$(api_get "/metrics/dns/errors/summary?minutes=5" || echo '{}')
  POST_NXDOMAIN=$(echo "$POST_SUMMARY" | json_get "rcode_counts.NXDOMAIN" 2>/dev/null || echo 0)
  POST_NXDOMAIN=${POST_NXDOMAIN:-0}

  if [ "$POST_NXDOMAIN" -gt "$BASE_NXDOMAIN" ]; then
    ok "NXDOMAIN aumentou ($BASE_NXDOMAIN → $POST_NXDOMAIN)"
  else
    warn "NXDOMAIN não aumentou via /summary (pode depender do worker cycle)"
    LIVE=$(api_get "/metrics/dns/errors/live?since=30" || echo '{}')
    LIVE_NXDOMAIN=$(echo "$LIVE" | json_get "rcode_counts.NXDOMAIN" 2>/dev/null || echo 0)
    if [ "${LIVE_NXDOMAIN:-0}" -gt 0 ]; then
      ok "NXDOMAIN detectado via /live ($LIVE_NXDOMAIN)"
    else
      fail "NXDOMAIN não detectado nem via /live"
    fi
  fi
else
  skip "Sem VIP4 para teste NXDOMAIN"
fi

# ==============================================================================
header "BLOCO 3 — TIMEOUT REAL VIA NFT"
# ==============================================================================

if [ ${#UPSTREAM4_BLOCKS[@]} -eq 0 ] && [ ${#UPSTREAM6_BLOCKS[@]} -eq 0 ]; then
  skip "Sem upstreams detectados nos forward-addr dos unbound*.conf"
else
  read -r -p "  Aplicar bloqueio temporário via nft para testar timeout? (y/N) " REPLY
  if [[ "$REPLY" =~ ^[Yy]$ ]]; then
    cleanup_nft_timeout_rules
    nft add table inet dns_obsv_test
    nft 'add chain inet dns_obsv_test output { type filter hook output priority -5; policy accept; }'

    for ip in "${UPSTREAM4_BLOCKS[@]}"; do
      nft add rule inet dns_obsv_test output ip daddr "$ip" udp dport 53 counter drop 2>/dev/null || true
      nft add rule inet dns_obsv_test output ip daddr "$ip" tcp dport 53 counter drop 2>/dev/null || true
    done

    for ip6 in "${UPSTREAM6_BLOCKS[@]}"; do
      nft add rule inet dns_obsv_test output ip6 daddr "$ip6" udp dport 53 counter drop 2>/dev/null || true
      nft add rule inet dns_obsv_test output ip6 daddr "$ip6" tcp dport 53 counter drop 2>/dev/null || true
    done

    ok "Bloqueio temporário aplicado"
    echo "  Upstreams bloqueados: ${UPSTREAM4_BLOCKS[*]} ${UPSTREAM6_BLOCKS[*]}"

    BASE_TIMEOUT_SUMMARY=$(api_get "/metrics/dns/errors/summary?minutes=5" || echo '{}')
    BASE_SERVFAIL=$(echo "$BASE_TIMEOUT_SUMMARY" | json_get "rcode_counts.SERVFAIL" 2>/dev/null || echo 0)
    BASE_SERVFAIL=${BASE_SERVFAIL:-0}

    TARGET_VIP="${VIP4:-$VIP6}"
    if [ -n "$TARGET_VIP" ]; then
      for i in $(seq 1 3); do
        dig "timeout-test-${i}-$(date +%s).com" @"$TARGET_VIP" +time=3 +tries=1 >/dev/null 2>&1 &
      done
      wait
      ok "3 queries de timeout enviadas"
      echo "  Aguardando ${TIMEOUT_WAIT}s para coleta..."
      sleep "$TIMEOUT_WAIT"
    else
      warn "Nenhum VIP detectado para teste"
    fi

    cleanup_nft_timeout_rules
    ok "Bloqueio removido"

    POST_TIMEOUT_SUMMARY=$(api_get "/metrics/dns/errors/summary?minutes=5" || echo '{}')
    POST_SERVFAIL=$(echo "$POST_TIMEOUT_SUMMARY" | json_get "rcode_counts.SERVFAIL" 2>/dev/null || echo 0)
    POST_SERVFAIL=${POST_SERVFAIL:-0}

    if [ "$POST_SERVFAIL" -gt "$BASE_SERVFAIL" ]; then
      ok "SERVFAIL aumentou ($BASE_SERVFAIL → $POST_SERVFAIL) — timeout detectado como SERVFAIL"
    else
      LIVE=$(api_get "/metrics/dns/errors/live?since=60" || echo '{}')
      LIVE_SF=$(echo "$LIVE" | json_get "rcode_counts.SERVFAIL" 2>/dev/null || echo 0)
      if [ "${LIVE_SF:-0}" -gt 0 ]; then
        ok "SERVFAIL detectado via /live ($LIVE_SF)"
      else
        warn "SERVFAIL/TIMEOUT não aumentou; Unbound pode ter resolvido via cache ou retry"
      fi
    fi
  else
    skip "Teste de timeout pulado pelo operador"
  fi
fi

# ==============================================================================
header "BLOCO 4 — CORRELAÇÃO DE EVENTOS"
# ==============================================================================

LIVE_ERRORS=$(api_get "/metrics/dns/errors/live?since=600" || echo '{}')

CORR_RESULT=$(python3 - <<'PY' <<<"$LIVE_ERRORS"
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    print("  ✗ JSON inválido na resposta de /live")
    sys.exit(2)

errors = data.get("errors", []) if isinstance(data, dict) else []
if not errors:
    print("  ✗ Nenhum evento encontrado em /live (últimos 600s)")
    print("  Dica: verifique se o dns_error_worker está rodando e o journalctl retorna logs")
    sys.exit(1)

print(f"  Total de eventos em /live: {len(errors)}")

e = errors[0]
# Fields from dns_error_collector_service: qname, qtype, client_ip, rcode, status, instance_name, source, confidence
required = ["client_ip", "qname", "rcode"]
advanced = ["instance_name", "source", "confidence", "qtype", "status"]

missing = [k for k in required if not e.get(k)]
present_adv = [k for k in advanced if e.get(k) is not None]

print("  Primeiro evento:")
for k, v in e.items():
    print(f"    {k}: {v}")
print(f"  Campos obrigatórios ausentes: {missing if missing else 'nenhum'}")
print(f"  Campos avançados presentes: {present_adv}")

if missing:
    sys.exit(3)
sys.exit(0)
PY
)
CORR_EXIT=$?
echo "$CORR_RESULT"

case $CORR_EXIT in
  0) ok "Evento mínimo de correlação presente" ;;
  1) fail "Sem eventos em /live" ;;
  2) fail "JSON inválido em /live" ;;
  3) fail "Evento sem campos mínimos obrigatórios" ;;
esac

# ==============================================================================
header "BLOCO 5 — NAT / DNAT / INSTÂNCIAS"
# ==============================================================================

if nft list ruleset 2>/dev/null | grep -Eq 'dnat to .*:53'; then
  ok "Ruleset contém DNAT para DNS"
  DNAT_TARGETS=$(nft list ruleset 2>/dev/null | grep -oP 'dnat to \K[^ ]+' | sort -u || true)
  echo "  Alvos DNAT:"
  echo "$DNAT_TARGETS" | sed 's/^/    /'
else
  warn "Ruleset sem DNAT para DNS (modo recursivo simples?)"
fi

UB_ACTIVE=$(systemctl list-units --type=service --no-pager --plain 2>/dev/null | grep -c "unbound[0-9]\+\.service" || true)
if [ "$UB_ACTIVE" -gt 0 ]; then
  ok "Instâncias Unbound ativas: $UB_ACTIVE"
  systemctl list-units --type=service --no-pager --plain 2>/dev/null | grep "unbound[0-9]" | sed 's/^/    /'
else
  fail "Nenhuma instância Unbound detectada"
fi

# ==============================================================================
header "BLOCO 6 — FALLBACKS (sem dnstap)"
# ==============================================================================

STATS_RESP=$(api_get "/metrics/dns/errors/stats" || echo '{}')
STATS_SOURCE=$(echo "$STATS_RESP" | json_get "source" 2>/dev/null || echo "")
STATS_FIDELITY=$(echo "$STATS_RESP" | json_get "fidelity" 2>/dev/null || echo "")
STATS_TOTAL=$(echo "$STATS_RESP" | json_get "total_errors" 2>/dev/null || echo "0")

if [ -n "$STATS_SOURCE" ]; then
  ok "Fallback /stats responde (source=$STATS_SOURCE fidelity=$STATS_FIDELITY total=$STATS_TOTAL)"
else
  fail "Fallback /stats não respondeu"
fi

SUMMARY_RESP=$(api_get "/metrics/dns/errors/summary?minutes=60" || echo '{}')
SUMMARY_SOURCE=$(echo "$SUMMARY_RESP" | json_get "source" 2>/dev/null || echo "")
SUMMARY_TOTAL=$(echo "$SUMMARY_RESP" | json_get "total_errors" 2>/dev/null || echo "0")

if [ -n "$SUMMARY_SOURCE" ]; then
  ok "Endpoint /summary responde (source=$SUMMARY_SOURCE total=$SUMMARY_TOTAL)"
else
  fail "Endpoint /summary não respondeu"
fi

# ==============================================================================
header "BLOCO 7 — PERFORMANCE / SAÚDE DO COLLECTOR"
# ==============================================================================

if systemctl is-active "$DNSTAP_SERVICE" >/dev/null 2>&1; then
  DNSTAP_PID=$(systemctl show "$DNSTAP_SERVICE" --property=MainPID --value 2>/dev/null || echo "")
  if [ -n "$DNSTAP_PID" ] && [ "$DNSTAP_PID" != "0" ]; then
    RSS_KB=$(ps -o rss= -p "$DNSTAP_PID" 2>/dev/null | tr -d ' ' || echo "0")
    CPU=$(ps -o %cpu= -p "$DNSTAP_PID" 2>/dev/null | tr -d ' ' || echo "0")
    RSS_MB=$(python3 -c "print(round(${RSS_KB:-0}/1024, 1))" 2>/dev/null || echo "?")
    ok "Collector PID=$DNSTAP_PID  CPU=${CPU}%  MEM=${RSS_MB}MB"
  else
    warn "Collector PID não encontrado"
  fi
else
  skip "Collector dnstap inativo — performance não medida"
fi

if systemctl is-active dns-control-api >/dev/null 2>&1; then
  API_PID=$(systemctl show dns-control-api --property=MainPID --value 2>/dev/null || echo "")
  if [ -n "$API_PID" ] && [ "$API_PID" != "0" ]; then
    RSS_KB=$(ps -o rss= -p "$API_PID" 2>/dev/null | tr -d ' ' || echo "0")
    CPU=$(ps -o %cpu= -p "$API_PID" 2>/dev/null | tr -d ' ' || echo "0")
    RSS_MB=$(python3 -c "print(round(${RSS_KB:-0}/1024, 1))" 2>/dev/null || echo "?")
    ok "API PID=$API_PID  CPU=${CPU}%  MEM=${RSS_MB}MB"
  fi
fi

# ==============================================================================
header "RESULTADO FINAL"
# ==============================================================================

TOTAL=$((PASS + FAIL + SKIP))
echo
echo -e "  ${GREEN}Passou: $PASS${NC} | ${RED}Falhou: $FAIL${NC} | ${BLUE}Pulou: $SKIP${NC} | Total: $TOTAL"
echo
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}█ VALIDAÇÃO SEM FALHAS CRÍTICAS${NC}"
  echo -e "  Sistema pronto para observabilidade DNS em produção."
else
  echo -e "  ${RED}█ VALIDAÇÃO INCOMPLETA — $FAIL falha(s) detectada(s)${NC}"
  echo -e "  Revise os itens marcados com ✗ acima."
fi
echo
