// ─────────────────────────────────────────────────────────────────────────
// DNS Control — Root Trust Anchor (DNSSEC KSK) — SNAPSHOT DETERMINÍSTICO
// ─────────────────────────────────────────────────────────────────────────
// Espelho exato de backend/app/generators/data/root.key (paridade FE/BE).
// Versão IANA: 2024-07-18 (KSK-2017 + KSK-2024 coexistindo).
//
// REGRAS DE DETERMINISMO (não violar):
//   1. Conteúdo idêntico ao snapshot do backend — qualquer divergência
//      viola a paridade obrigatória entre os geradores.
//   2. PROIBIDO baixar o anchor em runtime (deploy ou build).
//   3. Atualizações exigem PR alterando AMBOS os arquivos (backend + este).
//   4. Após o seed, manutenção é IN-BAND via RFC 5011 (não é download HTTP).
//   5. Modo SIMPLES não referencia este anchor (sem validator local).
// ─────────────────────────────────────────────────────────────────────────

export const ROOT_TRUST_ANCHOR_VERSION = '2024-07-18';

export const ROOT_TRUST_ANCHOR_KEY = `; ─────────────────────────────────────────────────────────────────────────
; DNS Control — Root Trust Anchor (DNSSEC KSK) — SNAPSHOT DETERMINÍSTICO
; ─────────────────────────────────────────────────────────────────────────
; Origem oficial : https://data.iana.org/root-anchors/root-anchors.xml
; Versão IANA    : ${ROOT_TRUST_ANCHOR_VERSION} (KSK-2017 + KSK-2024 coexistindo)
; Mantido por    : DNS Control — versionado no repositório (SSOT = Git)
;
; REGRAS DE DETERMINISMO (não violar):
;   1. Este arquivo é o SEED inicial de /var/lib/unbound/root.key.
;   2. PROIBIDO download em runtime durante deploy (curl/wget/unbound-anchor).
;   3. PROIBIDO depender de conectividade externa para materializar o seed.
;   4. Após o seed, o Unbound mantém o anchor IN-BAND via RFC 5011 (probes
;      DNS para o próprio KSK da raiz). Isso NÃO é download HTTP — é o
;      mecanismo padrão e seguro de rollover automático do KSK.
;   5. Atualizações da raiz exigem PR explícito alterando este arquivo
;      e bump da "Versão IANA" acima — deploys ficam reproduzíveis offline.
;   6. Frontend e backend leem o MESMO snapshot (paridade obrigatória).
;   7. Modo SIMPLES não usa este arquivo (sem validator local).
;
; Formato: DS records (aceitos por auto-trust-anchor-file/trust-anchor-file
; do Unbound como seed; serão promovidos a DNSKEY managed-keys via RFC 5011).
; ─────────────────────────────────────────────────────────────────────────
.       IN DS   20326 8 2 E06D44B80B8F1D39A95C0B0D7C65D08458E880409BBC683457104237C7F8EC8D
.       IN DS   38696 8 2 683D2D0ACB8C9B712A1948B27F741219298D0A450D612C483AF444A4C0FB2B16
`;
