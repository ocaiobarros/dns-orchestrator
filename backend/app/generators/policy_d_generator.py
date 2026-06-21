"""
DNS Control — POL-2b policy.d generator.

Generates /etc/unbound/policy.d/200-operator-blocks.conf from enabled
operator block rules (layer=200, kind=block_name, source=operator).

DESIGN INVARIANTS
─────────────────
1. JUDICIAL PRECEDENCE (CRITICAL): if a judicial rule (layer=100) exists for
   the same target — or for an ancestor domain that suffix-covers the target —
   the operator rule is OMITTED from generation. Why two layers of defense?

   (a) Generation-time dedup (this module): we never emit an operator
       directive that could potentially conflict with a judicial directive
       sourced from the DB mirror.
   (b) Include-order in unbound.conf (unbound_generator.py): policy.d/*.conf
       is included BEFORE anablock.conf. Unbound's `local-zone` honors a
       last-wins rule on duplicates, so anything in anablock.conf (judicial,
       layer 100) wins over policy.d (operator, layer 200) even when AnaBlock
       is populated at runtime by the sync script (no DB knowledge required).

   The two defenses are independent on purpose: (a) catches duplicates we
   know about (DB-mirrored judicial); (b) catches duplicates we cannot know
   about (runtime-synced anablock.conf). Removing either weakens the
   guarantee.

2. PURE FUNCTION: this module does NOT touch the DB or disk. It takes plain
   lists/dicts so it is trivial to unit-test and exactly mirrors the FE
   generator philosophy (paridade FE↔BE). Callers (policy_service) are
   responsible for collecting rules from the DB.

3. DETERMINISTIC OUTPUT: rules are sorted by target so the same DB state
   always yields byte-identical files (clean diffs in preview/apply).
"""

from __future__ import annotations

from typing import Iterable, TypedDict


POLICY_D_PATH = "/etc/unbound/policy.d/200-operator-blocks.conf"

_ALLOWED_ACTIONS = {"always_nxdomain", "always_refuse"}


class OperatorBlockRule(TypedDict, total=False):
    target: str
    action: str
    enabled: bool
    scope_view: str | None
    id: str


def _normalize(target: str) -> str:
    return (target or "").strip().lower().rstrip(".")


def _is_suffix_covered(target: str, judicial_targets: set[str]) -> bool:
    """True if `target` equals or is a sub-domain of any judicial target."""
    t = _normalize(target)
    if not t:
        return False
    if t in judicial_targets:
        return True
    parts = t.split(".")
    for i in range(1, len(parts)):
        parent = ".".join(parts[i:])
        if parent in judicial_targets:
            return True
    return False


def generate_policy_d_files(
    operator_rules: Iterable[OperatorBlockRule],
    judicial_targets: Iterable[str] = (),
) -> tuple[list[dict], list[dict]]:
    """
    Build the operator-blocks policy.d file.

    Returns
    -------
    files : list[dict]
        Single file dict shaped like the rest of the generators
        ({"path","content","permissions","owner"}). The file is always
        emitted (even with zero effective rules) so deploy diffs are
        deterministic and the include-glob is never empty.
    omitted : list[dict]
        Entries `{target, reason, judicial_match}` describing every rule that
        was suppressed by the judicial-precedence invariant. Surfaced by the
        preview endpoint so admins SEE the protection working.
    """
    jud = {_normalize(t) for t in judicial_targets if t}

    seen: set[tuple[str, str | None]] = set()
    rendered: list[str] = []
    omitted: list[dict] = []

    # MVP scope: global rules only (scope_view is None). View-scoped rules
    # land with multi-view in POL-6 — until then we silently ignore them so
    # a future seed cannot accidentally produce global blocks.
    rules = sorted(
        (r for r in operator_rules if r.get("enabled") and r.get("scope_view") in (None, "")),
        key=lambda r: _normalize(r.get("target", "")),
    )

    for r in rules:
        target = _normalize(r.get("target", ""))
        action = r.get("action", "always_nxdomain")
        if not target:
            continue
        if action not in _ALLOWED_ACTIONS:
            omitted.append({"target": target, "reason": "invalid_action", "action": action})
            continue
        # Judicial precedence (defense (a)): drop ops that collide with layer 100.
        if _is_suffix_covered(target, jud):
            # Determine the most specific judicial ancestor for the audit trail.
            match = target if target in jud else next(
                ".".join(target.split(".")[i:])
                for i in range(1, len(target.split(".")))
                if ".".join(target.split(".")[i:]) in jud
            )
            omitted.append({
                "target": target,
                "reason": "judicial_precedence",
                "judicial_match": match,
            })
            continue
        key = (target, r.get("scope_view"))
        if key in seen:
            continue
        seen.add(key)
        rendered.append(f'    local-zone: "{target}" {action}')

    header = (
        "# DNS Control — Operator block rules (POL-2b, layer=200)\n"
        "# Generated from policy_rules where source='operator' AND enabled=1.\n"
        "# Included by unbound.conf BEFORE anablock.conf so judicial layer-100\n"
        "# directives (last-wins in unbound's local-zone parser) always win.\n"
        "# Do NOT edit by hand — changes will be overwritten on next apply.\n"
    )
    if not rendered:
        body = "# (no enabled operator block rules)\n"
    else:
        body = "\n".join(rendered) + "\n"

    return (
        [{
            "path": POLICY_D_PATH,
            "content": header + body,
            "permissions": "0644",
            "owner": "root:unbound",
        }],
        omitted,
    )
