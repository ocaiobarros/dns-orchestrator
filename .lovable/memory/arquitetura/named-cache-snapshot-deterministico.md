---
name: named.cache Snapshot Determinístico
description: /etc/unbound/named.cache é gerado a partir de snapshot IANA versionado no repo, sem download em runtime
type: constraint
---
/etc/unbound/named.cache é materializado a partir de um snapshot IANA versionado
no repositório. Regras invioláveis:

1. PROIBIDO baixar root hints em runtime durante deploy (curl/wget/dig).
2. PROIBIDO depender de conectividade externa para materializar o arquivo.
3. PROIBIDO depender de cópia pré-existente em /etc/unbound/named.cache do host.
4. Atualizações de root servers exigem PR explícito alterando AMBOS os arquivos
   espelhados (paridade FE/BE obrigatória):
   - backend: backend/app/generators/data/named.cache
   - frontend: src/lib/root-hints.ts (ROOT_HINTS_NAMED_CACHE)
5. Bump da "Versão IANA" no header dos dois arquivos sempre que atualizar.

Materialização:
- Backend: unbound_generator._generate_root_hints() lê o arquivo versionado.
- Backend staging (deploy_service): usa o mesmo loader, NUNCA copia do host.
- Frontend: generateAllFiles emite o arquivo no modo Interceptação a partir
  da constante ROOT_HINTS_NAMED_CACHE.

**Why:** garantir deploys 100% determinísticos e reproduzíveis offline.
Qualquer download em runtime quebra reprodutibilidade e introduz dependência
de rede no momento crítico do deploy.
