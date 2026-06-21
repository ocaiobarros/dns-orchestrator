"""
RBAC regression test (GO-3):

Locks in that EVERY mutating route (POST/PUT/PATCH/DELETE) under
backend/app/api/routes/ is guarded by `require_admin`, except a small
explicit allowlist of self-service auth endpoints. If a new mutating
route is added without `require_admin`, this test fails — preventing
the original GO-3 broken-access-control class of bug from reappearing.

Also asserts that:
  * /api/prometheus stays unauthenticated (firm decision).
  * /api/kiosk endpoints remain at viewer level (get_current_user),
    NOT require_admin (kiosk sessions are low-trust read-only).
"""

import ast
import pathlib
import unittest

ROUTES_DIR = pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "routes"

# Self-service auth endpoints intentionally available to authenticated
# non-admin users (viewers MUST be able to log out, refresh their
# session, and change their own password). `login` itself is anonymous.
AUTH_SELF_SERVICE = {
    ("auth.py", "/login"),                 # anonymous, public by design
    ("auth.py", "/logout"),                # any session can log itself out
    ("auth.py", "/refresh"),               # any session can refresh
    ("auth.py", "/change-password"),       # self password change
    ("auth.py", "/force-change-password"), # forced first-login change
}

MUTATING_METHODS = {"post", "put", "patch", "delete"}


def _iter_route_decorators(tree: ast.AST):
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call):
                continue
            func = dec.func
            if not (isinstance(func, ast.Attribute)
                    and isinstance(func.value, ast.Name)
                    and func.value.id == "router"):
                continue
            method = func.attr.lower()
            path = ""
            if dec.args and isinstance(dec.args[0], ast.Constant):
                path = str(dec.args[0].value)
            yield method, path, node


def _has_require_admin(func_node: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    for arg in (*func_node.args.args, *func_node.args.kwonlyargs):
        default = None
        # Defaults align with the tail of args; FastAPI uses Depends() in default.
        # Walk the full function source for a Depends(require_admin) call instead —
        # robust to arg ordering.
    src = ast.unparse(func_node)
    return "Depends(require_admin)" in src


def _has_any_auth(func_node) -> bool:
    src = ast.unparse(func_node)
    return "Depends(require_admin)" in src or "Depends(get_current_user)" in src


class RbacEnforcementTest(unittest.TestCase):
    def test_every_mutating_route_requires_admin(self):
        offenders = []
        for path in sorted(ROUTES_DIR.glob("*.py")):
            tree = ast.parse(path.read_text())
            for method, route_path, node in _iter_route_decorators(tree):
                if method not in MUTATING_METHODS:
                    continue
                key = (path.name, route_path)
                if key in AUTH_SELF_SERVICE:
                    continue
                if not _has_require_admin(node):
                    offenders.append(f"{path.name}::{method.upper()} {route_path}")
        self.assertEqual(
            offenders, [],
            "Mutating routes missing Depends(require_admin):\n  - "
            + "\n  - ".join(offenders)
            + "\n\nAdd Depends(require_admin) or explicitly allowlist in "
              "AUTH_SELF_SERVICE with a justification."
        )

    def test_prometheus_endpoint_has_no_auth(self):
        """Firm decision: /api/prometheus is scraped anonymously."""
        path = ROUTES_DIR / "metrics.py"
        tree = ast.parse(path.read_text())
        found = False
        for method, route_path, node in _iter_route_decorators(tree):
            if method == "get" and route_path == "":
                found = True
                self.assertFalse(
                    _has_any_auth(node),
                    "/api/prometheus must NOT require authentication "
                    "(decision: standard Prometheus scraping).",
                )
        self.assertTrue(found, "Expected the /api/prometheus GET route in metrics.py")

    def test_kiosk_route_is_viewer_level_not_admin(self):
        """Kiosk endpoints are low-trust read-only — must NOT escalate to admin."""
        path = ROUTES_DIR / "kiosk.py"
        tree = ast.parse(path.read_text())
        for method, route_path, node in _iter_route_decorators(tree):
            src = ast.unparse(node)
            self.assertNotIn(
                "Depends(require_admin)", src,
                f"kiosk route {method.upper()} {route_path} must not require admin"
            )


if __name__ == "__main__":
    unittest.main()
