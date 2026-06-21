# Verificação Empírica — Precedência Judicial contra Unbound REAL

**Tarefa:** POL-2b/POL-3b — confirmar que a precedência judicial (anablock) sobre
allow_exception (layer 400) e operator block (layer 200) não é apenas um modelo
de last-wins no parser do teste, mas o comportamento REAL do Unbound.

**Data:** 2026-06-21
**Unbound testado:** `Version 1.24.2` (nixpkgs, build determinístico —
`/nix/store/.../unbound-1.24.2/bin/unbound -V`)
**dig:** BIND 9.20.18

---

## Procedimento

Os arquivos `200-operator-blocks.conf` e `400-allow-exceptions.conf` foram
gerados pelo gerador real do produto
(`backend/app/generators/policy_d_generator.py::generate_policy_d_files`) com
o seguinte estado:

- Operator block (layer 200): `blocked-by-operator.example`, `court.example`
- Judicial targets (layer 100): `court.example`
- Allow exceptions (layer 400): `blocked-by-operator.example`,
  `court.example` (tentativa de un-block do judicial)

Comportamento esperado do gerador:
- `200-operator-blocks.conf` **omite** `court.example` (dedup judicial em
  generation-time) → confirmado: `OMITTED: [{'target': 'court.example',
  'reason': 'judicial_precedence', 'judicial_match': 'court.example'}]`
- `400-allow-exceptions.conf` mantém `court.example` (não há dedup
  generation-time para layer 400 — a defesa é o include-order)

`unbound.conf` mínimo construído com a MESMA ordem de include do produto
(`unbound_generator.py`): `policy.d/*.conf` **antes de** `anablock.conf`.

```
include: "/tmp/ubtest/200-operator-blocks.conf"
include: "/tmp/ubtest/400-allow-exceptions.conf"
include: "/tmp/ubtest/anablock.conf"
```

`anablock.conf` (simulando regra judicial layer-100):
```
server:
    local-zone: "court.example." always_nxdomain
```

`unbound-checkconf`: **OK** (apenas warnings `duplicate local-zone` esperados —
é exatamente o mecanismo que valida last-wins).

Unbound subiu em `127.0.0.1@5354` e foi consultado com `dig`.

---

## Saída real — dois casos provados

### CASO A — operator-bloqueado + allow_exception → DEVE RESOLVER

```
$ dig @127.0.0.1 -p 5354 blocked-by-operator.example A +short
192.0.2.10

;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 16913
;; ANSWER SECTION:
blocked-by-operator.example. 3600 IN	A	192.0.2.10
```

A exceção (`transparent` em `400-...`) sobrescreveu o `always_nxdomain` de
`200-...` — confirma que **exception un-bloqueia operator**.

### CASO B — judicial + allow_exception (tentativa) → DEVE PERMANECER BLOQUEADO

```
$ dig @127.0.0.1 -p 5354 court.example A +short
(sem resposta)

;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 43094
;; flags: qr aa rd ra; QUERY: 1, ANSWER: 0
```

Apesar do `local-zone: "court.example" transparent` em
`400-allow-exceptions.conf`, o Unbound retornou **NXDOMAIN** porque
`anablock.conf` foi incluído depois e seu `always_nxdomain` venceu por
last-wins — confirma que **judicial vence allow_exception** no Unbound real.

### CONTROLE — nome neutro → RESOLVE
```
$ dig @127.0.0.1 -p 5354 neutral.example A +short
192.0.2.30
```

---

## Conclusão

A premissa "Unbound 1.24.2 aplica last-wins para `local-zone` duplicado e
respeita a ordem de include para resolver duplicatas entre arquivos" foi
**confirmada empiricamente** contra o binário real. O invariante de compliance
judicial do POL-3b (operador NÃO consegue allow-listar nome com ordem
judicial) está validado tanto pelo modelo (test_policy_plane.py) quanto pelo
comportamento real do resolver.

Nenhuma divergência observada — nenhum achado P1 a reportar.

## Como reproduzir

```bash
# 1. Gerar os arquivos pelo gerador real
python3 -c "
import sys; sys.path.insert(0,'backend')
from app.generators.policy_d_generator import generate_policy_d_files
files,_ = generate_policy_d_files(
    [{'target':'blocked-by-operator.example','action':'always_nxdomain','enabled':True,'scope_view':None}],
    ['court.example'],
    [{'target':'blocked-by-operator.example','enabled':True,'scope_view':None},
     {'target':'court.example','enabled':True,'scope_view':None}],
)
for f in files: open('/tmp/ubtest/'+f['path'].split('/')[-1],'w').write(f['content'])
"

# 2. Construir unbound.conf incluindo policy.d/* ANTES de anablock.conf
#    (ver bloco de include acima)

# 3. Validar e subir Unbound efêmero em porta alta
unbound-checkconf /tmp/ubtest/unbound.conf
unbound -c /tmp/ubtest/unbound.conf &

# 4. Consultar os dois casos
dig @127.0.0.1 -p 5354 blocked-by-operator.example A +short  # esperado: 192.0.2.10
dig @127.0.0.1 -p 5354 court.example A +short                # esperado: NXDOMAIN
```
