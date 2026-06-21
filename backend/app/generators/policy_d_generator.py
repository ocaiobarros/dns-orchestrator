"""
DNS Control — policy.d generators.

POL-2b: 200-operator-blocks.conf (kind=block_name, layer=200).
POL-3b: 400-allow-exceptions.conf (kind=allow_exception, layer=400).

DESIGN INVARIANTS
─────────────────
1. JUDICIAL PRECEDENCE (CRITICAL):
   (a) Generation-time dedup for OPERATOR BLOCKS only: layer-200 rules whose
       target equals or is a sub-domain of a known layer-100 (judicial) rule
       are dropped from 200-operator-blocks.conf.
   (b) Include-order in unbound_generator.py: policy.d/*.conf is included
       BEFORE anablock.conf. Unbound's local-zone uses last-wins, so any
       judicial directive (in anablock.conf) overrides anything in policy.d —
       including a 400-allow-exceptions transparent. This is the SOLE
       mechanism that prevents an operator allow_exception from un-blocking a
       court-ordered name. There is no generation-time dedup for layer 400 on
       purpose: the API-level guard (POL-3a) handles DB-known judicial, and
       runtime anablock.conf (downloaded outside the DB) is handled by (b).

2. ALLOW EXCEPTIONS OVERRIDE OPERATOR BLOCKS (POL-3b):
   Both files live under policy.d/*.conf which is included as a glob. The
   `400-` prefix guarantees the allow file is parsed AFTER 200- (and any
   future 300- feeds), so `local-zone "<name>" transparent` wins over
   `local-zone "<name>" always_nxdomain/always_refuse` — un-blocking the
   name. The judicial layer (anablock.conf, included AFTER policy.d) still
   wins because it is parsed last.

3. PURE FUNCTIONS: no DB or disk access here.

4. DETERMINISTIC OUTPUT: rules sorted by target — byte-identical files for
   identical DB state (clean diffs in preview/apply).
"""

from __future__ import annotations

from typing import Iterable, TypedDict


POLICY_D_PATH = "/etc/unbound/policy.d/200-operator-blocks.conf"
ALLOW_EXCEPTIONS_PATH = "/etc/unbound/policy.d/400-allow-exceptions.conf"

_ALLOWED_ACTIONS = {"always_nxdomain", "always_refuse"}


class OperatorBlockRule(TypedDict, total=False):
    target: str
    action: str
    enabled: bool
    scope_view: str | None
    id: str


class AllowExceptionRule(TypedDict, total=False):
    target: str
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


def _generate_operator_block_file(
    operator_rules: Iterable[OperatorBlockRule],
    judicial_targets: Iterable[str],
) -> tuple[dict, list[dict]]:
    jud = {_normalize(t) for t in judicial_targets if t}
    seen: set[tuple[str, str | None]] = set()
    rendered: list[str] = []
    omitted: list[dict] = []

    # MVP scope: global rules only (scope_view is None). View-scoped rules
    # land with multi-view in POL-6.
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
        if _is_suffix_covered(target, jud):
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
    body = "\n".join(rendered) + "\n" if rendered else "# (no enabled operator block rules)\n"
    return (
        {
            "path": POLICY_D_PATH,
            "content": header + body,
            "permissions": "0644",
            "owner": "root:unbound",
        },
        omitted,
    )


def _generate_allow_exceptions_file(
    allow_rules: Iterable[AllowExceptionRule],
) -> dict:
    """
    POL-3b — `local-zone "<target>" transparent` for each enabled exception.

    Lexicographic include order (`400-` after `200-`/`300-`) makes transparent
    win over operator/feed local-zones. Judicial (anablock.conf, included
    AFTER policy.d) still wins by include-order — never deduped here.
    """
    seen: set[tuple[str, str | None]] = set()
    rendered: list[str] = []

    rules = sorted(
        (r for r in allow_rules if r.get("enabled") and r.get("scope_view") in (None, "")),
        key=lambda r: _normalize(r.get("target", "")),
    )
    for r in rules:
        target = _normalize(r.get("target", ""))
        if not target:
            continue
        key = (target, r.get("scope_view"))
        if key in seen:
            continue
        seen.add(key)
        rendered.append(f'    local-zone: "{target}" transparent')

    header = (
        "# DNS Control — Operator allow exceptions (POL-3b, layer=400)\n"
        "# Generated from policy_rules where kind='allow_exception' AND enabled=1.\n"
        "# `transparent` un-blocks names matched by operator/feed local-zones\n"
        "# (200/300) since policy.d/*.conf is included in lexicographic order.\n"
        "# Judicial (anablock.conf) is included AFTER policy.d, so it ALWAYS\n"
        "# wins — operator cannot allow-list a court-ordered name.\n"
        "# Do NOT edit by hand — changes will be overwritten on next apply.\n"
    )
    body = "\n".join(rendered) + "\n" if rendered else "# (no enabled allow exceptions)\n"
    return {
        "path": ALLOW_EXCEPTIONS_PATH,
        "content": header + body,
        "permissions": "0644",
        "owner": "root:unbound",
    }


def generate_policy_d_files(
    operator_rules: Iterable[OperatorBlockRule],
    judicial_targets: Iterable[str] = (),
    allow_exceptions: Iterable[AllowExceptionRule] = (),
) -> tuple[list[dict], list[dict]]:
    """
    Build all policy.d files.

    Returns
    -------
    files : list[dict]
        Files in lexicographic-include order:
          1) 200-operator-blocks.conf
          2) 400-allow-exceptions.conf
        Both are always emitted (empty placeholder if no rules) so deploy
        diffs are deterministic and the include-glob is never empty.
    omitted : list[dict]
        Operator rules suppressed by judicial-precedence dedup. Allow
        exceptions are never omitted here — judicial precedence is enforced
        at API-create (POL-3a) and at runtime via include-order (defense (b)).
    """
    op_file, omitted = _generate_operator_block_file(operator_rules, judicial_targets)
    allow_file = _generate_allow_exceptions_file(allow_exceptions)
    return [op_file, allow_file], omitted
