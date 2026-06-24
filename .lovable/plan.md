## Problema

Em Interceptação Pura, `frontendDnsIp` no state fica vazio (só é preenchido para "VIP Próprio"), e o fallback do Dashboard (`vip_anycast.find(non-CGN)`) acaba pegando o EGRESS `45.232.215.16` em vez do VIP interceptado `4.2.2.5`. O VIP correto está em `normalized["interceptedVips"]` mas nunca é persistido no state nem exposto ao front.

## Fix — backend é a fonte da verdade

### 1. `backend/app/services/deploy_service.py::_save_deploy_state` (linhas 2380-2420)

Extrair `interceptedVips` do payload normalizado e DERIVAR `frontend_dns_ip` quando vazio:

```python
intercepted_raw = normalized.get("interceptedVips") or wizard_cfg.get("interceptedVips") or []
intercepted_v4: list[str] = []
intercepted_v6: list[str] = []
for v in intercepted_raw:
    if isinstance(v, dict):
        ip4 = str(v.get("vipIp") or "").strip()
        ip6 = str(v.get("vipIpv6") or "").strip()
        if ip4: intercepted_v4.append(ip4)
        if ip6: intercepted_v6.append(ip6)

frontend_dns_ip = (normalized.get("frontendDnsIp") or "").strip()
# Interceptação Pura: sem VIP próprio, o frontend É o VIP interceptado.
if not frontend_dns_ip and intercepted_v4 and "intercep" in operation_mode.lower():
    frontend_dns_ip = intercepted_v4[0]
```

Persistir no state:
```python
"frontendDnsIp": frontend_dns_ip,
"frontendDnsIpv6": (intercepted_v6[0] if intercepted_v6 and not normalized.get("frontendDnsIpv6") else normalized.get("frontendDnsIpv6", "")),
"interceptedVips": intercepted_v4,
"interceptedVipsIpv6": intercepted_v6,
```

### 2. `backend/app/services/diagnostics_service.py` (~280-330)

Já lê `frontendDnsIp` do state — agora vem correto. Expor também a lista para o front:
```python
"frontend_dns_ip": frontend_dns_ip,
"frontend_dns_ipv6": deploy_state.get("frontendDnsIpv6", ""),
"intercepted_vips": deploy_state.get("interceptedVips", []),
```

### 3. `backend/app/api/routes/dashboard.py:41`

Sem mudança funcional — `state.get("frontendDnsIp")` agora retorna o VIP interceptado em Interceptação Pura.

## Fix — frontend defensivo

### 4. `src/pages/Dashboard.tsx` (linhas 92-98)

Remover o fallback para `vip_anycast` (que mistura egress). Nova cadeia:
```typescript
const interceptedVips: string[] = Array.isArray((sysInfo as any)?.intercepted_vips)
  ? (sysInfo as any).intercepted_vips.filter(Boolean)
  : [];
const singleVipHint = (deployState?.frontendDnsIp || sysInfo?.frontend_dns_ip || '').trim();
const frontendIp = singleVipHint || interceptedVips[0] || '—';
```

O fallback para `vip_anycast.find(non-CGN)` é REMOVIDO — `vip_anycast` é uma lista heterogênea (egress + VIPs + listeners visíveis) e não dá para identificar "qual é o frontend" só por exclusão de CGN. O backend agora entrega o VIP correto.

## Critérios de aceite

1. Modo Interceptação Pura (sem `frontendDnsIp` no wizard, com `interceptedVips: [{vipIp: "4.2.2.5"}]`) → card "Frontend DNS (VIP)" mostra `4.2.2.5`.
2. Modo VIP Próprio (com `frontendDnsIp: "172.250.40.3"`) → mostra `172.250.40.3` (inalterado).
3. Egress (`45.232.215.16`) NUNCA aparece como frontend.
4. `tsgo --noEmit` verde; testes backend verdes.

## Entrega

- Diff de `_save_deploy_state` (derivação + persistência de `interceptedVips`).
- Diff de `diagnostics_service.py` (expor `intercepted_vips`).
- Diff de `Dashboard.tsx` (cadeia de fallback sem `vip_anycast`).
- Teste backend cobrindo: Interceptação Pura sem `frontendDnsIp` resulta em `state.frontendDnsIp == interceptedVips[0]`.
