---
name: Layout Homologado Paths
description: Modo Interceptação usa exclusivamente /etc/network/nftables.d/. Sem fallback nem caminho híbrido.
type: constraint
---

# Caminhos do Layout Homologado — Modo Interceptação

Decisão definitiva e travada: o modo **DNS Recursivo com Interceptação** segue
fielmente o layout do servidor homologado em produção.

## Caminhos OBRIGATÓRIOS (modo Interceptação)

- Fragmentos nftables: `/etc/network/nftables.d/*.nft`
- Helpers de rede: `/etc/network/nftables.d/interfaces`, `/etc/network/nftables.d/post-up.sh`
- `/etc/nftables.conf` com `include "/etc/network/nftables.d/*.nft"`
- `/etc/unbound/unbound.conf.d/remote-control.conf` (drop-in compartilhado)
- `/etc/unbound/unbound.conf.d/root-auto-trust-anchor-file.conf`
- `/etc/unbound/block-domains.txt` (lista LOCAL/manual, independente do AnaBlock)
- `/etc/unbound/gen-block-domains.sh` (gera unbound-block-domains.conf a partir do .txt)
- `/etc/unbound/unbound-block-domains.conf` (SEMPRE existe — placeholder vazio quando lista vazia)
- `/etc/unbound/anablock.conf` (SEMPRE existe — placeholder seguro quando off)
- `/etc/unbound/named.cache` (snapshot IANA versionado)

## PROIBIÇÕES no modo Interceptação

- Não usar `/etc/nftables.d/`
- Não criar symlink `/etc/nftables.d → /etc/network/nftables.d`
- Não suportar caminho híbrido ou fallback
- AnaBlock e block-domains.txt são pipelines INDEPENDENTES — não misturar

## Modo Simples (Local Balancing)

Mantém `/etc/nftables.d/` (não faz parte do layout homologado, é uma feature
exclusiva do produto). O `nftables.conf` gerado pelo modo simples sobrescreve
o include para `/etc/nftables.d/*.nft`.

## Pipeline gen-block-domains.sh

Lê `/etc/unbound/block-domains.txt` (uma entrada DNS-válida por linha) e
gera `/etc/unbound/unbound-block-domains.conf` no formato:

```
local-zone: "<dominio>" always_nxdomain
```

É operado manualmente pelo administrador — não é automatizado nem misturado
com a sincronização AnaBlock.
