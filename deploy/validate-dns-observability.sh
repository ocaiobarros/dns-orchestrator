#!/bin/bash
# ==============================================================================
# DNS Control — Validação Operacional da Observabilidade DNS v2
# Executar NO HOST REAL como root
# Detecta automaticamente o perfil: DNS Comum ou DNS com Interceptação (VIP)
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
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0
NA=0

ok()   { echo -e "  ${GREEN}✓ $1${NC}"; ((PASS++)); }
fail() { echo -e "  ${RED}✗ $1${NC}"; ((FAIL++)); }
warn() { echo -e "  ${YELLOW}⚠ $1${NC}"; }
skip() { echo -e "  ${BLUE}↷ $1${NC}"; ((SKIP++)); }
na()   { echo -e "  ${CYAN}— $1 [N/A: $PROFILE_LABEL]${NC}"; ((NA++)); }
header() { echo -e "\n${YELLOW}════ $1 ════${NC}"; }

# --- Profile detection ---
PROFILE=""          # "common" or "intercept"
PROFILE_LABEL=""
HAS_VIP=false
HAS_DNAT=false
DNS_TARGET=""       # IP to use for dig tests (VIP or listener)

# --- Auth ---
AUTH_ARGS=()
if [ -n "$TOKEN" ]; then
  AUTH_ARGS=(-H "Authorization: Bearer $TOKEN")
fi

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { fail "Comando obrigatório ausente: $1"; exit 1; }
}

api_get() {
  local path="$1"
  if [ ${#AUTH_ARGS[@]} -gt 0 ]; then
    curl -sf "${AUTH_ARGS[@]}" "$API$path" 2>/dev/null
  else
    curl -sf "$API$path" 2>/dev/null
  fi
}

api_get_verbose() {
  local path="$1"
  local http_code
  if [ ${#AUTH_ARGS[@]} -gt 0 ]; then
    http_code=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH_ARGS[@]}" "$API$path" 2>/dev/null)
  else
    http_code=$(curl -s -o /dev/null -w '%{http_code}' "$API$path" 2>/dev/null)
  fi
  echo "$http_code"
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
            try: cur = cur[int(p)]
            except (ValueError, IndexError): print(""); return
        else: print(""); return
    if cur is None: print("")
    elif isinstance(cur, (dict, list)): print(json.dumps(cur))
    else: print(cur)
get_path(data, expr)
PY
}

cleanup_nft_timeout_rules() {
  nft list table inet dns_obsv_test >/dev/null 2>&1 && nft delete table inet dns_obsv_test >/dev/null 2>&1 || true
}
trap cleanup_nft_timeout_rules EXIT

# --- Discovery functions ---

discover_vips_from_api() {
  local resp
  resp=$(api_get "/inventory/vips" 2>/dev/null || echo "")
  [ -z "$resp" ] && return 1
  python3 <<'PY' <<<"$resp"
import json, sys, ipaddress
try: data = json.load(sys.stdin)
except: sys.exit(1)
items = []
if isinstance(data, dict):
    for key in ("vips", "items", "intercepted_vips"):
        if key in data and isinstance(data[key], list):
            items = data[key]; break
vip4 = vip6 = ""
for item in items:
    if isinstance(item, dict):
        for k in ("vip", "ip", "address", "vip_ip"):
            if k in item:
                try:
                    ip = ipaddress.ip_address(str(item[k]))
                    if ip.version == 4 and not vip4: vip4 = str(ip)
                    elif ip.version == 6 and not vip6: vip6 = str(ip)
                except: pass
    elif isinstance(item, str):
        try:
            ip = ipaddress.ip_address(item)
            if ip.version == 4 and not vip4: vip4 = str(ip)
            elif ip.version == 6 and not vip6: vip6 = str(ip)
        except: pass
print(vip4); print(vip6)
PY
}

discover_vips_from_host() {
  python3 <<'PY'
import json, subprocess, ipaddress, sys
vip4 = vip6 = ""
try:
    out = subprocess.check_output(["ip", "-j", "addr"], text=True)
    data = json.loads(out)
except: print(""); print(""); sys.exit(0)
for iface in data:
    name = iface.get("ifname", "")
    for a in iface.get("addr_info", []):
        local, fam, prefix = a.get("local"), a.get("family"), a.get("prefixlen")
        if not local: continue
        try: ip = ipaddress.ip_address(local)
        except: continue
        if fam == "inet" and not ip.is_loopback and prefix == 32 and name.startswith("lo"):
            if not local.startswith("100."): vip4 = vip4 or local
        elif fam == "inet6" and not (ip.is_loopback or ip.is_link_local) and prefix == 128 and name.startswith("lo"):
            vip6 = vip6 or local
print(vip4); print(vip6)
PY
}

discover_listeners() {
  # Find Unbound listener IPs from configs
  grep -RhoP '^\s*interface:\s*\K[0-9a-f.:]+' /etc/unbound/unbound*.conf 2>/dev/null | \
    grep -v '^127\.' | grep -v '^::1' | head -5
}

discover_upstreams() {
  grep -RhoP '^\s*forward-addr:\s*\K\S+' /etc/unbound/unbound*.conf 2>/dev/null | sort -u
}

detect_dnat() {
  nft list ruleset 2>/dev/null | grep -Eq 'dnat to .*:53'
}

choose_vips() {
  if [ -z "$VIP4" ] || [ -z "$VIP6" ]; then
    mapfile -t api_vips < <(discover_vips_from_api 2>/dev/null || true)
    [ -z "$VIP4" ] && VIP4="${api_vips[0]:-}"
    [ -z "$VIP6" ] && VIP6="${api_vips[1]:-}"
  fi
  if [ -z "$VIP4" ] || [ -z "$VIP6" ]; then
    mapfile -t host_vips < <(discover_vips_from_host)
    [ -z "$VIP4" ] && VIP4="${host_vips[0]:-}"
    [ -z "$VIP6" ] && VIP6="${host_vips[1]:-}"
  fi
}

split_upstreams() {
  UPSTREAM4_BLOCKS=()
  UPSTREAM6_BLOCKS=()
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [[ "$line" == *:* ]]; then UPSTREAM6_BLOCKS+=("$line")
    else UPSTREAM4_BLOCKS+=("$line"); fi
  done < <(discover_upstreams)
}

detect_profile() {
  choose_vips
  split_upstreams

  # Check for DNAT rules
  if detect_dnat; then HAS_DNAT=true; fi

  # Check for VIPs
  if [ -n "$VIP4" ] || [ -n "$VIP6" ]; then HAS_VIP=true; fi

  # Determine profile
  if $HAS_VIP && $HAS_DNAT; then
    PROFILE="intercept"
    PROFILE_LABEL="DNS com Interceptação (VIP)"
    DNS_TARGET="${VIP4:-$VIP6}"
  elif $HAS_DNAT; then
    PROFILE="intercept"
    PROFILE_LABEL="DNS com DNAT (sem VIP externo detectado)"
    # Use first DNAT source or listener
    DNS_TARGET=""
  else
    PROFILE="common"
    PROFILE_LABEL="DNS Comum (Recursivo)"
    DNS_TARGET=""
  fi

  # For common mode, find a usable DNS target (listener or localhost)
  if [ -z "$DNS_TARGET" ]; then
    # Try listeners from unbound configs
    LISTENER=$(discover_listeners | head -1)
    if [ -n "$LISTENER" ]; then
      DNS_TARGET="$LISTENER"
    else
      # Try DNAT targets (backend IPs)
      if $HAS_DNAT; then
        DNAT_IP=$(nft list ruleset 2>/dev/null | grep -oP 'dnat to \K[0-9.]+' | head -1 || true)
        if [ -n "$DNAT_IP" ]; then
          DNS_TARGET="$DNAT_IP"
        fi
      fi
      # Last resort: localhost
      [ -z "$DNS_TARGET" ] && DNS_TARGET="127.0.0.1"
    fi
  fi
}

# ==============================================================================
header "BLOCO 0 — PRÉ-CHECAGENS E DETECÇÃO DE PERFIL"
# ==============================================================================

require_cmd curl
require_cmd dig
require_cmd systemctl
require_cmd ss
require_cmd nft
require_cmd python3
require_cmd journalctl

detect_profile

echo -e "  ${BOLD}Perfil detectado: ${CYAN}${PROFILE_LABEL}${NC}"
echo "  API: $API"
echo "  DNS Target: ${DNS_TARGET:-<nenhum>}"
if [ "$PROFILE" = "intercept" ]; then
  echo "  VIP4: ${VIP4:-<nenhum>}"
  echo "  VIP6: ${VIP6:-<nenhum>}"
fi
echo "  Upstreams IPv4: ${UPSTREAM4_BLOCKS[*]:-<nenhum>}"
echo "  Upstreams IPv6: ${UPSTREAM6_BLOCKS[*]:-<nenhum>}"
echo "  DNAT detectado: $HAS_DNAT"
echo

# API health
if systemctl is-active dns-control-api >/dev/null 2>&1; then
  ok "dns-control-api ativo"
else
  fail "dns-control-api inativo"
fi

# Auth check — endpoints require valid token; 404 without auth means middleware rejected
AUTH_CODE=$(api_get_verbose "/metrics/dns/errors/stats")
if [ "$AUTH_CODE" = "401" ] || [ "$AUTH_CODE" = "403" ] || { [ "$AUTH_CODE" = "404" ] && [ -z "$TOKEN" ]; }; then
  if [ -z "$TOKEN" ]; then
    warn "Endpoints requerem autenticação (HTTP $AUTH_CODE)"
    warn "Use: TOKEN=\$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{\"username\":\"admin\",\"password\":\"...\"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"token\"])')"
    fail "TOKEN não fornecido — endpoints autenticados falharão"
  else
    warn "Endpoint retornou HTTP $AUTH_CODE mesmo com TOKEN (rota pode não existir)"
  fi
elif [ "$AUTH_CODE" = "000" ]; then
  fail "API não respondeu (conexão recusada)"
elif [ "$AUTH_CODE" = "200" ]; then
  ok "API acessível e autenticada (HTTP 200)"
else
  warn "API respondeu com HTTP $AUTH_CODE (verificar rota ou versão da API)"
fi

# DNS baseline
if [ -n "$DNS_TARGET" ]; then
  if dig @"$DNS_TARGET" google.com +time=2 +tries=1 +short >/dev/null 2>&1; then
    ok "DNS responde via $DNS_TARGET"
  else
    warn "DNS não respondeu via $DNS_TARGET"
  fi
fi

# ==============================================================================
header "BLOCO 1 — DNSTAP"
# ==============================================================================

DNSTAP_CONF=$(grep -Rni "dnstap-enable" /etc/unbound 2>/dev/null | head -20 || true)
if echo "$DNSTAP_CONF" | grep -qi "yes"; then
  ok "dnstap-enable: yes encontrado"
  echo "$DNSTAP_CONF" | sed 's/^/    /'
else
  warn "dnstap não configurado (fallback via logs será usado)"
fi

DNSTAP_SOCK_PATH=$(grep -RhoP 'dnstap-socket-path:\s*\K\S+' /etc/unbound 2>/dev/null | head -1 || true)
if [ -n "$DNSTAP_SOCK_PATH" ]; then
  ok "Socket path: $DNSTAP_SOCK_PATH"
  [ -S "$DNSTAP_SOCK_PATH" ] && ok "Socket file existe" || warn "Socket file ausente"
fi

if systemctl is-active "$DNSTAP_SERVICE" >/dev/null 2>&1; then
  ok "$DNSTAP_SERVICE ativo"
  journalctl -u "$DNSTAP_SERVICE" -n 5 --no-pager 2>/dev/null | sed 's/^/    /'
else
  warn "$DNSTAP_SERVICE inativo (fallback será usado)"
fi

# ==============================================================================
header "BLOCO 2 — DETECÇÃO DE NXDOMAIN"
# ==============================================================================

if [ -n "$DNS_TARGET" ]; then
  BASE_SUMMARY=$(api_get "/metrics/dns/errors/summary?minutes=5" || echo '{}')
  BASE_NXDOMAIN=$(echo "$BASE_SUMMARY" | json_get "rcode_counts.NXDOMAIN" 2>/dev/null || echo 0)
  BASE_NXDOMAIN=${BASE_NXDOMAIN:-0}

  for i in $(seq 1 5); do
    dig "teste-inexistente-${i}-$(date +%s).invalid" @"$DNS_TARGET" +time=2 +tries=1 >/dev/null 2>&1 &
  done
  wait
  ok "5 queries NXDOMAIN enviadas via $DNS_TARGET"

  echo "  Aguardando ${BASELINE_WAIT}s para coleta..."
  sleep "$BASELINE_WAIT"

  POST_SUMMARY=$(api_get "/metrics/dns/errors/summary?minutes=5" || echo '{}')
  POST_NXDOMAIN=$(echo "$POST_SUMMARY" | json_get "rcode_counts.NXDOMAIN" 2>/dev/null || echo 0)
  POST_NXDOMAIN=${POST_NXDOMAIN:-0}

  if [ "$POST_NXDOMAIN" -gt "$BASE_NXDOMAIN" ]; then
    ok "NXDOMAIN aumentou ($BASE_NXDOMAIN → $POST_NXDOMAIN)"
  else
    warn "NXDOMAIN não aumentou via /summary (verificando /live...)"
    LIVE=$(api_get "/metrics/dns/errors/live?since=30" || echo '{}')
    LIVE_NX=$(echo "$LIVE" | json_get "rcode_counts.NXDOMAIN" 2>/dev/null || echo 0)
    if [ "${LIVE_NX:-0}" -gt 0 ]; then
      ok "NXDOMAIN detectado via /live ($LIVE_NX)"
    else
      fail "NXDOMAIN não detectado"
    fi
  fi
else
  skip "Sem DNS target para teste NXDOMAIN"
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

    ok "Bloqueio temporário aplicado (${UPSTREAM4_BLOCKS[*]} ${UPSTREAM6_BLOCKS[*]})"

    BASE_SF=$(api_get "/metrics/dns/errors/summary?minutes=5" | json_get "rcode_counts.SERVFAIL" 2>/dev/null || echo 0)
    BASE_SF=${BASE_SF:-0}

    if [ -n "$DNS_TARGET" ]; then
      for i in $(seq 1 3); do
        dig "timeout-test-${i}-$(date +%s).com" @"$DNS_TARGET" +time=3 +tries=1 >/dev/null 2>&1 &
      done
      wait
      ok "3 queries de timeout enviadas"
      echo "  Aguardando ${TIMEOUT_WAIT}s..."
      sleep "$TIMEOUT_WAIT"
    fi

    cleanup_nft_timeout_rules
    ok "Bloqueio removido"

    POST_SF=$(api_get "/metrics/dns/errors/summary?minutes=5" | json_get "rcode_counts.SERVFAIL" 2>/dev/null || echo 0)
    POST_SF=${POST_SF:-0}

    if [ "$POST_SF" -gt "$BASE_SF" ]; then
      ok "SERVFAIL aumentou ($BASE_SF → $POST_SF)"
    else
      LIVE_SF=$(api_get "/metrics/dns/errors/live?since=60" | json_get "rcode_counts.SERVFAIL" 2>/dev/null || echo 0)
      if [ "${LIVE_SF:-0}" -gt 0 ]; then
        ok "SERVFAIL detectado via /live ($LIVE_SF)"
      else
        warn "SERVFAIL não detectado (cache/retry pode ter mascarado)"
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

CORR_RESULT=$(python3 - "$PROFILE" <<'PY' <<<"$LIVE_ERRORS"
import json, sys
profile = sys.argv[1]
try: data = json.load(sys.stdin)
except:
    print("  ✗ JSON inválido na resposta de /live")
    sys.exit(2)

errors = data.get("errors", []) if isinstance(data, dict) else []
if not errors:
    print("  ✗ Nenhum evento encontrado em /live (últimos 600s)")
    print("  Dica: verifique se o dns_error_worker está rodando e o journalctl retorna logs do Unbound")
    sys.exit(1)

print(f"  Total de eventos em /live: {len(errors)}")

e = errors[0]
required = ["client_ip", "qname", "rcode"]
advanced_common = ["instance_name", "source", "confidence", "qtype", "status"]
advanced_vip = ["vip", "backend_ip"]

missing = [k for k in required if not e.get(k)]
present_common = [k for k in advanced_common if e.get(k) is not None]
present_vip = [k for k in advanced_vip if e.get(k) is not None]

print("  Primeiro evento:")
for k, v in e.items():
    print(f"    {k}: {v}")
print(f"  Campos obrigatórios ausentes: {missing if missing else 'nenhum'}")
print(f"  Campos avançados: {present_common}")
if profile == "intercept":
    print(f"  Campos VIP: {present_vip if present_vip else 'nenhum (esperado no modo interceptação)'}")

if missing: sys.exit(3)
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
header "BLOCO 5 — INFRAESTRUTURA DNS"
# ==============================================================================

# Instâncias Unbound (obrigatório em ambos os perfis)
UB_ACTIVE=$(systemctl list-units --type=service --no-pager --plain 2>/dev/null | grep -c "unbound[0-9]\+\.service" || true)
if [ "$UB_ACTIVE" -gt 0 ]; then
  ok "Instâncias Unbound ativas: $UB_ACTIVE"
  systemctl list-units --type=service --no-pager --plain 2>/dev/null | grep "unbound[0-9]" | sed 's/^/    /'
else
  fail "Nenhuma instância Unbound detectada"
fi

# DNAT / VIP — condicional ao perfil
if [ "$PROFILE" = "intercept" ]; then
  if $HAS_DNAT; then
    ok "Ruleset contém DNAT para DNS"
    DNAT_TARGETS=$(nft list ruleset 2>/dev/null | grep -oP 'dnat to \K[^ ]+' | sort -u || true)
    echo "  Alvos DNAT:"
    echo "$DNAT_TARGETS" | sed 's/^/    /'
  else
    fail "Perfil interceptação mas sem DNAT no ruleset"
  fi

  if $HAS_VIP; then
    ok "VIPs detectados (v4=${VIP4:-n/a} v6=${VIP6:-n/a})"
  else
    warn "Nenhum VIP externo detectado"
  fi
else
  na "DNAT/VIP — não aplicável para DNS Comum"
  # Show listeners instead
  LISTENERS=$(discover_listeners)
  if [ -n "$LISTENERS" ]; then
    ok "Listeners Unbound detectados:"
    echo "$LISTENERS" | sed 's/^/    /'
  fi
fi

# ==============================================================================
header "BLOCO 6 — ENDPOINTS API (FALLBACKS)"
# ==============================================================================

# /stats
STATS_CODE=$(api_get_verbose "/metrics/dns/errors/stats")
if [ "$STATS_CODE" = "200" ]; then
  STATS_RESP=$(api_get "/metrics/dns/errors/stats")
  STATS_SOURCE=$(echo "$STATS_RESP" | json_get "source" 2>/dev/null || echo "")
  STATS_FIDELITY=$(echo "$STATS_RESP" | json_get "fidelity" 2>/dev/null || echo "")
  STATS_TOTAL=$(echo "$STATS_RESP" | json_get "total_errors" 2>/dev/null || echo "0")
  ok "/stats responde (source=$STATS_SOURCE fidelity=$STATS_FIDELITY total=$STATS_TOTAL)"
elif [ "$STATS_CODE" = "401" ] || [ "$STATS_CODE" = "403" ]; then
  fail "/stats requer autenticação (HTTP $STATS_CODE) — forneça TOKEN"
else
  fail "/stats falhou (HTTP $STATS_CODE)"
fi

# /summary
SUMMARY_CODE=$(api_get_verbose "/metrics/dns/errors/summary?minutes=60")
if [ "$SUMMARY_CODE" = "200" ]; then
  SUMMARY_RESP=$(api_get "/metrics/dns/errors/summary?minutes=60")
  SUMMARY_SOURCE=$(echo "$SUMMARY_RESP" | json_get "source" 2>/dev/null || echo "")
  SUMMARY_TOTAL=$(echo "$SUMMARY_RESP" | json_get "total_errors" 2>/dev/null || echo "0")
  ok "/summary responde (source=$SUMMARY_SOURCE total=$SUMMARY_TOTAL)"
elif [ "$SUMMARY_CODE" = "401" ] || [ "$SUMMARY_CODE" = "403" ]; then
  fail "/summary requer autenticação (HTTP $SUMMARY_CODE) — forneça TOKEN"
else
  fail "/summary falhou (HTTP $SUMMARY_CODE)"
fi

# /live
LIVE_CODE=$(api_get_verbose "/metrics/dns/errors/live?since=60")
if [ "$LIVE_CODE" = "200" ]; then
  ok "/live responde (HTTP 200)"
elif [ "$LIVE_CODE" = "401" ] || [ "$LIVE_CODE" = "403" ]; then
  fail "/live requer autenticação (HTTP $LIVE_CODE)"
else
  fail "/live falhou (HTTP $LIVE_CODE)"
fi

# ==============================================================================
header "BLOCO 7 — PERFORMANCE / SAÚDE"
# ==============================================================================

if systemctl is-active "$DNSTAP_SERVICE" >/dev/null 2>&1; then
  DNSTAP_PID=$(systemctl show "$DNSTAP_SERVICE" --property=MainPID --value 2>/dev/null || echo "")
  if [ -n "$DNSTAP_PID" ] && [ "$DNSTAP_PID" != "0" ]; then
    RSS_KB=$(ps -o rss= -p "$DNSTAP_PID" 2>/dev/null | tr -d ' ' || echo "0")
    CPU=$(ps -o %cpu= -p "$DNSTAP_PID" 2>/dev/null | tr -d ' ' || echo "0")
    RSS_MB=$(python3 -c "print(round(${RSS_KB:-0}/1024, 1))" 2>/dev/null || echo "?")
    ok "Collector PID=$DNSTAP_PID  CPU=${CPU}%  MEM=${RSS_MB}MB"
  fi
else
  skip "Collector dnstap inativo"
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

TOTAL=$((PASS + FAIL + SKIP + NA))
echo
echo -e "  ${BOLD}Perfil: ${CYAN}${PROFILE_LABEL}${NC}"
echo -e "  ${GREEN}Passou: $PASS${NC} | ${RED}Falhou: $FAIL${NC} | ${BLUE}Pulou: $SKIP${NC} | ${CYAN}N/A: $NA${NC} | Total: $TOTAL"
echo
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}█ VALIDAÇÃO SEM FALHAS CRÍTICAS${NC}"
  echo -e "  Sistema pronto para observabilidade DNS em produção."
else
  echo -e "  ${RED}█ VALIDAÇÃO INCOMPLETA — $FAIL falha(s) detectada(s)${NC}"
  echo -e "  Revise os itens marcados com ✗ acima."
fi
echo
