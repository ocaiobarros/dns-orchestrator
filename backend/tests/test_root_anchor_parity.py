"""Frozen root trust anchor (root.key) — bootstrap offline, paridade FE↔BE."""
import re
import unittest
from pathlib import Path

from app.generators.unbound_generator import generate_unbound_configs

_BACKEND_ROOT_KEY = Path(__file__).resolve().parents[1] / "app" / "generators" / "data" / "root.key"
_FRONTEND_ROOT_ANCHOR = Path(__file__).resolve().parents[2] / "src" / "lib" / "root-anchor.ts"

# IANA root KSK DS records (KSK-2017 + KSK-2024). These are the ground truth
# the snapshot must always contain.
_DS_KSK_2017 = ".       IN DS   20326 8 2 E06D44B80B8F1D39A95C0B0D7C65D08458E880409BBC683457104237C7F8EC8D"
_DS_KSK_2024 = ".       IN DS   38696 8 2 683D2D0ACB8C9B712A1948B27F741219298D0A450D612C483AF444A4C0FB2B16"


def _payload(mode: str) -> dict:
    return {
        "operationMode": mode,
        "ipv4Address": "172.250.40.11/23",
        "enableIpv6": False,
        "threads": 4,
        "securityProfile": "isp-hardened",
        "instances": [
            {
                "name": "unbound01",
                "bindIp": "100.127.255.120",
                "controlInterface": "127.0.0.11",
                "controlPort": 8953,
            },
        ],
        "_wizardConfig": {
            "operationMode": mode,
            "ipv4Address": "172.250.40.11/23",
            "threads": 4,
            "securityProfile": "isp-hardened",
        },
    }


class RootAnchorFrozenSnapshotTest(unittest.TestCase):
    def test_backend_root_key_contains_both_ksk_ds_records(self):
        body = _BACKEND_ROOT_KEY.read_text(encoding="utf-8")
        self.assertIn(_DS_KSK_2017, body)
        self.assertIn(_DS_KSK_2024, body)

    def test_backend_root_key_has_deterministic_header(self):
        body = _BACKEND_ROOT_KEY.read_text(encoding="utf-8")
        self.assertIn("SNAPSHOT DETERMINÍSTICO", body)
        self.assertIn("PROIBIDO download em runtime", body)

    def test_frontend_mirror_contains_identical_ds_records(self):
        ts = _FRONTEND_ROOT_ANCHOR.read_text(encoding="utf-8")
        self.assertIn(_DS_KSK_2017, ts)
        self.assertIn(_DS_KSK_2024, ts)

    def test_frontend_and_backend_share_the_same_ds_payload(self):
        """The DS lines (the only security-critical bytes) must match exactly."""
        be = _BACKEND_ROOT_KEY.read_text(encoding="utf-8").splitlines()
        fe = _FRONTEND_ROOT_ANCHOR.read_text(encoding="utf-8").splitlines()
        be_ds = [ln for ln in be if re.match(r"^\.\s+IN\s+DS\s", ln)]
        fe_ds = [ln for ln in fe if re.match(r"^\.\s+IN\s+DS\s", ln)]
        self.assertEqual(be_ds, fe_ds)
        self.assertEqual(len(be_ds), 2)


class RootAnchorGeneratorWiringTest(unittest.TestCase):
    def test_interception_emits_root_key_file_from_frozen_snapshot(self):
        files = generate_unbound_configs(_payload("interception"))
        root_key = next((f for f in files if f["path"] == "/var/lib/unbound/root.key"), None)
        self.assertIsNotNone(root_key, "interception deve materializar /var/lib/unbound/root.key")
        # Same bytes as the frozen snapshot — zero runtime fetch.
        self.assertEqual(root_key["content"], _BACKEND_ROOT_KEY.read_text(encoding="utf-8"))
        # Writable owner so RFC 5011 rollover funciona.
        self.assertEqual(root_key["owner"], "unbound:unbound")

    def test_simple_mode_does_not_emit_root_key(self):
        files = generate_unbound_configs(_payload("simple"))
        paths = [f["path"] for f in files]
        self.assertNotIn("/var/lib/unbound/root.key", paths)


if __name__ == "__main__":
    unittest.main()
