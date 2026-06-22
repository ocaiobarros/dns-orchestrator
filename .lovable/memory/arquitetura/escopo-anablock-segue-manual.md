---
name: Escopo AnaBlock Segue Manual
description: AnaBlock é integração OPCIONAL de terceiro (caixa-preta auto-atualizada); DNS Control não gerencia ciclo de vida judicial; sem mirror-no-DB; precedência via include-order já comprovada.
type: constraint
---

# Escopo da Integração AnaBlock

Decisão de produto ratificada pelo PO. Definitiva e travada.

## Contexto — origem e governança (Nuva)
AnaBlock é ferramenta de **código aberto da Nuva**. Embora aberta, **não a
modificamos**: a Nuva a mantém para entregá-la pronta, segura e com as ordens
judiciais atualizadas periodicamente. O DNS Control apenas **consome o
resultado pronto**, como integração opcional. Alterar o código da AnaBlock é
inviável e fora de escopo por princípio — o **ciclo de vida do dado judicial
é responsabilidade da Nuva**, não do DNS Control.

## Regra
- **AnaBlock é ferramenta de TERCEIRO**, caixa-preta auto-atualizada: novas
  ordens, revogações e expirações vêm prontas da AnaBlock.
- **O operador nunca gerencia/interfere/modifica** o conteúdo judicial.
- A **única** responsabilidade do DNS Control é integrá-la como funcionalidade
  **OPCIONAL** (liga/desliga no Wizard) e fazê-lo com segurança.
- **DNS Control NÃO gerencia o ciclo de vida do dado judicial.** Não há
  ingestão, edição, revisão, expiração ou versionamento próprio das ordens
  judiciais dentro do produto.
- **Não existe mirror-no-DB** das regras AnaBlock como `layer=100`. O DB de
  política contém apenas: judiciais explícitas opcionais autorais (raras),
  regras de operador (200), feeds genéricos (300, escopo POL-4 futuro) e
  allow_exception (400). AnaBlock vive **fora** desse DB, em `anablock.conf`.

## Responsabilidades do DNS Control (escopo restrito)
1. **Toggle opcional** no Wizard (habilita/desabilita a integração).
2. **Sync seguro** seguindo o manual oficial AnaBlock
   (`/api/version`, `/domains/all?output=unbound`, `/ipv4/block`, etc.).
3. **`unbound-checkconf` antes de aplicar** — payload inválido é rejeitado, o
   arquivo bom anterior permanece (fail-safe judicial).
4. **Include-order**: `anablock.conf` é incluído em `unbound.conf` **depois**
   de `policy.d/*.conf`, garantindo precedência judicial por "last-wins" do
   `local-zone` no Unbound.
5. **Observabilidade**: surfaçar última atualização, contagem, status e stale
   na UI/telemetria — sem editar conteúdo.

## Precedência judicial — comprovada empiricamente
- Validada contra Unbound real **1.24.2** em
  `docs/audits/2026-06_judicial-precedence-real-unbound.md` (dois casos:
  exceção un-bloqueia operador; judicial vence exceção e permanece bloqueado).
- Auditoria de aderência ao manual em
  `docs/audits/2026-06_anablock-integration-vs-manual.md`.

## Por quê (não fazer mirror)
- Manual é a fonte canônica; mirror duplica estado e cria divergência.
- Ciclo de vida judicial (ordens, revogações, expirações) é responsabilidade
  da AnaBlock — espelhar é assumir governança que não nos cabe.
- A precedência judicial já existe na camada certa (Unbound include-order) e
  foi auditada contra runtime real.

## Fronteira
- Feeds genéricos (layer 300) **não são AnaBlock**. Pipeline próprio (POL-4
  futuro) com governança/integridade/cadência distintas.
