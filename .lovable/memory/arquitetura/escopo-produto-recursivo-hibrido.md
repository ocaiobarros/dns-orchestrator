---
name: Escopo Produto Recursivo Híbrido
description: Contrato de escopo do DNS Control — plataforma de operação, observabilidade e aplicação de políticas sobre DNS recursivo Unbound; não autoritativo
type: constraint
---
Contrato de escopo vinculante do DNS Control. Define o que o produto É e o que
o produto NÃO É. Tarefas, planos e revisões devem ser avaliados contra este
contrato; qualquer proposta fora dele exige decisão explícita de mudança de
escopo antes de virar trabalho.

## Direção de produto

DNS Control é uma plataforma de OPERAÇÃO, OBSERVABILIDADE e APLICAÇÃO DE
POLÍTICAS para DNS recursivo de carrier sobre Unbound. O núcleo resolve, valida
e aplica política — não publica zonas autoritativas na Internet.

## EM ESCOPO (núcleo atual)

- Resolução recursiva (Unbound, multi-instância, dual-plane lo/lo0).
- Validação DNSSEC (resolver-side, com root hints versionados).
- `local-zone` e `local-data` (zonas e respostas locais dentro do recursivo).
- Overrides de resposta para domínios específicos.
- AnaBlock (bloqueio por IP de destino via rota blackhole no kernel).
- RPZ (Response Policy Zones) como mecanismo de política por nome.
- Feeds de reputação alimentando políticas de nome.
- Exceções (allowlist) sobre feeds, RPZ e AnaBlock.
- Políticas segmentadas por tenant / rede / view.
- Auditoria completa: quem operou o painel, o que foi aplicado, quando, e
  (na dimensão de consulta) atribuição por cliente conforme política LGPD.

## FORA DO ESCOPO ATUAL

- Gestão autoritativa de zonas DNS públicas.
- CRUD geral de registros (A/AAAA/MX/NS/SOA/TXT/SRV/...) para publicação
  autoritativa.
- Transferências de zona AXFR / IXFR.
- DNS UPDATE (RFC 2136).
- Assinatura DNSSEC de zonas (geração/rotação de KSK/ZSK, NSEC/NSEC3,
  re-signing).

`local-zone` / `local-data` / RPZ NÃO são autoritativos públicos: são política
interna do recursivo e permanecem em escopo. Não confundir com publicação
autoritativa na Internet, que está fora.

## Restrição vinculante (futuro autoritativo)

Se, no futuro, capacidade autoritativa for adicionada à oferta, ela DEVE ser:

1. Domínio separado do recursivo (produto / superfície / persistência
   próprios).
2. Control plane separado (UI, API, deploy, auditoria próprios — sem reuso
   acoplado da deploy pipeline do recursivo).
3. Software autoritativo apropriado (ex.: NSD, Knot, PowerDNS Authoritative) —
   nunca Unbound.
4. Sem acoplamento ao núcleo recursivo Unbound: o Unbound continua sendo
   exclusivamente resolver + política.

Propostas que tentem "ensinar" o Unbound a ser autoritativo público, ou que
plugem CRUD autoritativo dentro do control plane atual, violam este contrato.

## Nota técnica: dois planos de bloqueio distintos

Existem dois mecanismos de bloqueio que NÃO devem ser confundidos nem
fundidos:

- Bloqueio por IP de destino — AnaBlock. Atua no kernel via rota blackhole.
  Mecanismo existente e homologado. Não alterar como parte de trabalho de
  política de nome.
- Bloqueio / reescrita por NOME — RPZ, `local-zone`, `local-data`. Atua
  dentro do Unbound, na resolução do nome. Mecanismo de política de nome.

Decisão de qual plano aplicar é função do tipo de indicador (IP vs nome) e
da política, não preferência de implementação. Misturar os dois planos no
mesmo fluxo de aplicação quebra a auditoria e o modelo de exceção.

**Why:** sem este contrato escrito, propostas de "adicionar autoritativo",
"unificar bloqueios" ou "publicar zonas" reaparecem ciclicamente e arrastam o
produto para fora do núcleo homologado.

**How to apply:** ao receber qualquer tarefa, validar contra EM ESCOPO / FORA
DO ESCOPO antes de planejar. Se a tarefa pedir capacidade autoritativa
pública, AXFR/IXFR, DNS UPDATE ou assinatura DNSSEC, recusar como fora de
escopo e referenciar esta memória; mudança exige decisão explícita de produto.
