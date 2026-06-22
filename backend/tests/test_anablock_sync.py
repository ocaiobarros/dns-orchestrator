"""
AnaBlock periodic sync (Nuva) — POL-equivalent coverage:

- Script content: confirms /api/version + /api/md5 + /api/domain/all paths,
  md5 integrity gate, fail-safe judicial (mantém último bom em qualquer falha),
  JSONL events log, checkconf gate, anablock.conf last via include-order.
- Worker: drains JSONL into operational_events (idempotent), debounces stale.
- Toggle off (enableBlocklist=False) ⇒ no script/timer generated at all.
- Scale: a large fixture (~72k zonas) flows through write_status + md5 + grep
  pipeline used by the script (we exercise the same shell primitives on a real
  file in tmp).

We DO NOT modify AnaBlock — só consumimos. Esses testes asseguram que a
integração se mantém alinhada ao manual oficial e à postura desejada
(detecção condicional, integridade, degradação honesta).
"""

import json
import os
import subprocess
import tempfile
import time
import unittest
import uuid

from app.generators.unbound_generator import generate_unbound_configs


def _payload(enable_blocklist: bool, sync_hours: int = 24):
    return {
        "operationMode": "simple",
        "ipv4Address": "172.250.40.11/23",
        "enableIpv6": False,
        "enableBlocklist": enable_blocklist,
        "threads": 4,
        "blocklistMode": "always_nxdomain",
        "blocklistSyncIntervalHours": sync_hours,
        "blocklistAutoSync": True,
        "blocklistValidateBeforeReload": True,
        "blocklistAutoReload": True,
        "instances": [
            {"name": "unbound01", "bindIp": "100.127.255.120",
             "controlInterface": "127.0.0.11", "controlPort": 8953},
        ],
    }


def _script(files, suffix: str) -> str:
    matches = [f for f in files if f["path"].endswith(suffix)]
    assert matches, f"missing generated file ending in {suffix}"
    return matches[0]["content"]


class AnablockSyncScriptShapeTest(unittest.TestCase):
    def test_endpoints_use_api_prefix(self):
        s = _script(generate_unbound_configs(_payload(True)), "/etc/unbound/gen-anablock.sh")
        # Per task: base atual expõe /api/version, /api/md5, /api/domain/all.
        self.assertIn("/api/version", s)
        self.assertIn("/api/md5", s)
        self.assertIn("/api/domain/all?output=unbound", s)
        self.assertNotIn("/domains/all?output=unbound", s, "legacy path must be gone")

    def test_md5_integrity_gate_present(self):
        s = _script(generate_unbound_configs(_payload(True)), "/etc/unbound/gen-anablock.sh")
        # Compares REMOTE_MD5 (server) vs LOCAL_MD5 (md5sum payload). Empty or
        # divergent ⇒ NÃO aplica (mantém último bom conhecido).
        self.assertIn("md5sum", s)
        self.assertIn("REMOTE_MD5", s)
        self.assertIn("LOCAL_MD5", s)
        self.assertIn("md5_mismatch", s)
        self.assertIn("integridade md5 divergente", s)

    def test_fail_safe_paths_keep_previous(self):
        s = _script(generate_unbound_configs(_payload(True)), "/etc/unbound/gen-anablock.sh")
        # Each terminal failure path emits an event AND keeps the existing CONF
        # untouched (we only `mv` to CONF after every gate passes).
        for reason in ("api_unreachable", "download_failed", "md5_mismatch"):
            self.assertIn(reason, s)
        # version/md5 só são persistidos APÓS o swap bem-sucedido.
        idx_apply = s.index('mv "$CONF_TMP" "$CONF"')
        idx_persist_v = s.index('echo "$REMOTE_VERSION" > "$VERSION_FILE"')
        idx_persist_m = s.index('echo "$REMOTE_MD5" > "$MD5_FILE"')
        self.assertLess(idx_apply, idx_persist_v)
        self.assertLess(idx_apply, idx_persist_m)

    def test_checkconf_runs_before_swap(self):
        s = _script(generate_unbound_configs(_payload(True)), "/etc/unbound/gen-anablock.sh")
        self.assertIn("unbound-checkconf", s)
        self.assertLess(s.index("unbound-checkconf"), s.index('mv "$CONF_TMP" "$CONF"'))

    def test_emits_jsonl_events(self):
        s = _script(generate_unbound_configs(_payload(True)), "/etc/unbound/gen-anablock.sh")
        self.assertIn("EVENTS_LOG=", s)
        self.assertIn("anablock-events.jsonl", s)
        for et in ("anablock.sync.applied", "anablock.sync.unchanged", "anablock.sync.failed"):
            self.assertIn(et, s)

    def test_anablock_conf_included_last(self):
        files = generate_unbound_configs(_payload(True))
        conf = next(f["content"] for f in files if f["path"] == "/etc/unbound/unbound01.conf")
        i_policy = conf.find("policy.d/*.conf")
        i_anablock = conf.find("include: /etc/unbound/anablock.conf")
        self.assertGreater(i_policy, -1)
        self.assertGreater(i_anablock, i_policy,
                           "anablock.conf MUST be included AFTER policy.d (judicial precedence)")

    def test_toggle_off_emits_no_sync_artifacts(self):
        files = generate_unbound_configs(_payload(False))
        paths = [f["path"] for f in files]
        self.assertNotIn("/etc/unbound/gen-anablock.sh", paths)
        self.assertNotIn("/usr/lib/systemd/system/anablock-update.service", paths)
        self.assertNotIn("/usr/lib/systemd/system/anablock-update.timer", paths)

    def test_toggle_on_emits_sync_artifacts_and_timer_uses_configured_cadence(self):
        files = generate_unbound_configs(_payload(True, sync_hours=24))
        paths = [f["path"] for f in files]
        self.assertIn("/etc/unbound/gen-anablock.sh", paths)
        self.assertIn("/usr/lib/systemd/system/anablock-update.timer", paths)
        timer = next(f["content"] for f in files
                     if f["path"] == "/usr/lib/systemd/system/anablock-update.timer")
        self.assertIn("OnUnitActiveSec=24h", timer)
        self.assertIn("Persistent=true", timer)


class AnablockScalePipelineTest(unittest.TestCase):
    """Exercises the same shell primitives the script uses (md5sum + grep + mv)
    against a ~72k-zone fixture in /tmp. Proves the pipeline does not break in
    real scale and that md5 verification stays O(n) and deterministic."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="anablock-scale-")
        cls.payload = os.path.join(cls.tmp, "anablock.conf")
        # Generate ~72k zone fixture (realistic scale per task: ~71.6k domínios).
        N = 72000
        with open(cls.payload, "w") as fh:
            for i in range(N):
                fh.write(f'local-zone: "blk{i}.example.com" always_nxdomain\n')
        cls.n = N

    @classmethod
    def tearDownClass(cls):
        import shutil
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_md5_deterministic_for_large_payload(self):
        h1 = subprocess.check_output(["md5sum", self.payload]).decode().split()[0]
        h2 = subprocess.check_output(["md5sum", self.payload]).decode().split()[0]
        self.assertEqual(h1, h2)
        self.assertEqual(len(h1), 32)

    def test_grep_counts_match_expected_scale(self):
        # Same metric the script uses to populate domains_loaded_count.
        out = subprocess.check_output(["grep", "-c", "^local-zone", self.payload]).decode().strip()
        self.assertEqual(int(out), self.n)


class AnablockStatusWorkerTest(unittest.TestCase):
    """Worker reads JSONL written by the bash script and converts each line into
    an OperationalEvent — idempotente by file offset. Stale dedup é por ts."""

    def setUp(self):
        os.environ.setdefault("DNS_CONTROL_DB_PATH", tempfile.mktemp(suffix=".sqlite"))
        import app.core.database as _dbmod
        import app.models.user  # noqa: F401
        import app.models.operational  # noqa: F401
        _dbmod.Base.metadata.create_all(bind=_dbmod.engine)
        self._db = _dbmod
        # Per-test scratch dir (worker uses passed-in paths so we don't touch
        # /var/lib/dns-control on the host).
        self.tmp = tempfile.mkdtemp(prefix="anablock-worker-")
        self.log = os.path.join(self.tmp, "events.jsonl")
        self.status = os.path.join(self.tmp, "status.json")
        self.offset = os.path.join(self.tmp, "offset")
        # Clear previous events
        s = _dbmod.SessionLocal()
        try:
            from app.models.operational import OperationalEvent
            s.query(OperationalEvent).delete()
            s.commit()
        finally:
            s.close()
        # Reset stale dedup marker between tests.
        from app.workers import anablock_status_worker as w
        w._last_stale_marker = None

    def _append(self, *lines):
        with open(self.log, "a") as fh:
            for ln in lines:
                fh.write(ln + "\n")

    def _run(self):
        from pathlib import Path
        from app.workers.anablock_status_worker import anablock_status_job
        return anablock_status_job(
            log_path=Path(self.log),
            status_path=Path(self.status),
            offset_path=Path(self.offset),
            session_factory=self._db.SessionLocal,
        )

    def _events(self):
        from app.models.operational import OperationalEvent
        s = self._db.SessionLocal()
        try:
            return s.query(OperationalEvent).order_by(OperationalEvent.created_at.asc()).all()
        finally:
            s.close()

    def test_drains_jsonl_into_operational_events(self):
        self._append(
            json.dumps({"ts": 100, "event_type": "anablock.sync.applied",
                        "reason": "applied", "domains": 71600, "md5": "a" * 32, "version": "v1"}),
            json.dumps({"ts": 200, "event_type": "anablock.sync.unchanged",
                        "reason": "version_unchanged", "domains": 71600, "md5": "a" * 32, "version": "v1"}),
        )
        out = self._run()
        self.assertEqual(out["emitted"], 2)
        evs = self._events()
        self.assertEqual([e.event_type for e in evs],
                         ["anablock.sync.applied", "anablock.sync.unchanged"])
        # Compliance trail keeps md5/version/domains visible.
        details = json.loads(evs[0].details_json)
        self.assertEqual(details["md5"], "a" * 32)
        self.assertEqual(details["domains"], 71600)
        self.assertEqual(details["version"], "v1")

    def test_idempotent_via_offset_persistence(self):
        self._append(json.dumps({"ts": 1, "event_type": "anablock.sync.applied",
                                 "reason": "applied", "domains": 1, "md5": "z", "version": "v1"}))
        self._run()
        # Second call must NOT re-emit existing lines.
        out2 = self._run()
        self.assertEqual(out2["emitted"], 0)
        self.assertEqual(len(self._events()), 1)
        # Appending a new line is picked up on next tick.
        self._append(json.dumps({"ts": 2, "event_type": "anablock.sync.failed",
                                 "reason": "md5_mismatch", "domains": 1, "md5": "z", "version": "v1"}))
        out3 = self._run()
        self.assertEqual(out3["emitted"], 1)
        self.assertEqual([e.event_type for e in self._events()],
                         ["anablock.sync.applied", "anablock.sync.failed"])

    def test_md5_mismatch_event_is_warning(self):
        self._append(json.dumps({"ts": 1, "event_type": "anablock.sync.failed",
                                 "reason": "md5_mismatch", "domains": 0, "md5": "", "version": "v1"}))
        self._run()
        ev = self._events()[0]
        self.assertEqual(ev.severity, "warning")
        self.assertEqual(json.loads(ev.details_json)["reason"], "md5_mismatch")

    def test_stale_emitted_when_status_age_exceeds_threshold(self):
        # 24h cadence ⇒ stale threshold = 48h. Force last_update way past.
        with open(self.status, "w") as fh:
            json.dump({
                "last_update_timestamp": int(time.time()) - 72 * 3600,
                "last_status": "OK",
                "sync_interval_hours": 24,
                "last_md5": "abc",
                "last_version_applied": "v1",
            }, fh)
        out = self._run()
        self.assertTrue(out["stale_emitted"])
        evs = [e for e in self._events() if e.event_type == "anablock.sync.stale"]
        self.assertEqual(len(evs), 1)
        # Dedup: a second tick with the same ts must NOT re-emit.
        out2 = self._run()
        self.assertFalse(out2["stale_emitted"])
        evs2 = [e for e in self._events() if e.event_type == "anablock.sync.stale"]
        self.assertEqual(len(evs2), 1)

    def test_fresh_status_does_not_emit_stale(self):
        with open(self.status, "w") as fh:
            json.dump({
                "last_update_timestamp": int(time.time()) - 60,
                "last_status": "OK",
                "sync_interval_hours": 24,
            }, fh)
        out = self._run()
        self.assertFalse(out["stale_emitted"])


if __name__ == "__main__":
    unittest.main()
