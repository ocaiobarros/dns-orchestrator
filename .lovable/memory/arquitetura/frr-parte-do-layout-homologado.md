---
name: FRR Layout Homologado Oficial
description: FRR (frr.conf+daemons) é parte OFICIAL e estrutural do modo Interceptação — sempre gerado, nunca tratado como provisório
type: feature
---
FRR é parte OFICIAL do layout homologado do modo Interceptação. Comportamento:

1. /etc/frr/frr.conf e /etc/frr/daemons são SEMPRE materializados no modo
   Interceptação, mesmo com OSPF desativado. Isso NÃO é estado provisório —
   é o comportamento estrutural homologado.

2. OSPF off → daemons com ospfd=no, frr.conf como esqueleto comentado.
   OSPF on  → daemons com ospfd=yes, frr.conf com router OSPF, redistribuição
              e VIPs anunciados como rotas /32.

3. Paridade exata FE/BE:
   - frontend: src/lib/config-generator.ts (generateFrrConf, generateFrrDaemons)
   - backend:  backend/app/generators/frr_generator.py
   - normalizador: backend/app/services/payload_normalizer.py propaga enableOspf

4. Wizard tem etapa "Roteamento (FRR/OSPF)" exclusiva do modo Interceptação,
   com toggle Habilitar OSPF + campos (routerId, área, interfaces, custos,
   intervalos, redistribute connected). Refletido em JSON export/import.

5. No modo Simples, FRR NÃO faz parte do layout — arquivos não são gerados.

**Why:** servidor de produção homologado roda FRR como parte estrutural; tratar
FRR como "externo" ou "provisório" cria divergência permanente com produção.

**How to apply:** ao gerar arquivos para Interceptação, sempre incluir frr.conf
e daemons. Nunca condicionar a emissão ao toggle de OSPF — apenas o conteúdo
muda. Linguagem do produto deve evitar "placeholder provisório" e usar
"esqueleto estrutural" / "comportamento homologado".
