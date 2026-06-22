---
name: Escopo AnaBlock Segue Manual
description: AnaBlock é integração de terceiro que segue o manual oficial; sem mirror-no-DB; precedência via include-order já provada empiricamente.
type: constraint
---

# Escopo da Integração AnaBlock

Decisão definitiva e travada.

## Regra
- AnaBlock é ferramenta de **terceiro**. A integração segue o **manual oficial**
  da AnaBlock (`/api/version`, `/api/md5`, `/domains/all?output=unbound`,
  `/ipv4/block`, `/ipv4/unblock`, `/ipv6/*`). **Não inventar** mecanismos fora
  do manual.
- **Não existe** "mirror" que ingere o conjunto judicial AnaBlock como regras
  `layer=100` no DB de política. O DB de política contém apenas:
  - regras judiciais **explícitas** opcionais (layer 100, autoria do operador
    para casos pontuais);
  - regras de operador (layer 200);
  - feeds genéricos (layer 300, escopo POL-4);
  - allow_exception (layer 400).

## Precedência judicial — como é garantida
- `anablock.conf` é incluído em `unbound.conf` **depois** do glob
  `policy.d/*.conf`. Por "last-wins" do `local-zone` no Unbound, qualquer
  `local-zone` judicial vence operador/exceção.
- **Comprovado empiricamente** contra Unbound 1.24.2 — ver
  `docs/audits/2026-06_judicial-precedence-real-unbound.md`.
- O validador-no-DB de `allow_exception` (POL-3a) é apenas primeira-linha
  (UX/cedo); o **backstop definitivo** é o include-order.

## Por quê (não fazer mirror)
- Manual é a fonte canônica; mirror duplica estado e cria divergência.
- Conjunto judicial muda fora do produto — espelhar é responsabilidade
  desnecessária e risco de fora-de-sincronia.
- A garantia de precedência já existe na camada certa (Unbound include-order),
  e foi auditada contra runtime real.

## Fronteira
- Feeds genéricos (layer 300) **não são AnaBlock**. Têm pipeline próprio
  (POL-4 futuro), com governança/integridade/cadência distintas.
