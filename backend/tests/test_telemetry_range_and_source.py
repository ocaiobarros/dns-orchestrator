"""
Regression tests for FIX-OBS-CORRECTNESS:
  * /api/telemetry/recent-queries — honest `range` filtering with UTC
    midnight rollover and unparseable-timestamp handling.
  * /api/dns/metrics source envelope — must report `source='none'` and
    return an empty rows list when neither persisted nor live data are
    reachable (no synthetic [0,0] point).
"""

import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app.api.routes import telemetry as telemetry_route
from app.services import metrics_service


def _hhmmss(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%H:%M:%S")


class RecentQueriesRangeTest(unittest.TestCase):
    # 2026-06-21 12:00:00 UTC — well into the day, no midnight edge.
    NOON_EPOCH = 1782388800

    def _call(self, *, queries, now_epoch, range_value="1h", limit=200):
        with patch.object(telemetry_route, "_read_telemetry",
                          return_value={"recent_queries": queries}), \
             patch.object(telemetry_route.time, "time", return_value=now_epoch):
            return telemetry_route.telemetry_recent_queries(
                instance=None, qtype=None, range=range_value, limit=limit, _=None,
            )

    def test_small_range_fits_buffer_not_partial(self):
        # Buffer fully covers 1h: items spanning 70 minutes around `now`.
        now = self.NOON_EPOCH
        queries = [
            {"time": _hhmmss(now - 70 * 60), "type": "A", "name": "old.example."},
            {"time": _hhmmss(now - 30 * 60), "type": "A", "name": "mid.example."},
            {"time": _hhmmss(now - 5 * 60),  "type": "A", "name": "new.example."},
        ]
        out = self._call(queries=queries, now_epoch=now, range_value="1h")
        # The 70-min-old item must be dropped by the 1h window.
        names = [q["name"] for q in out["items"]]
        self.assertIn("mid.example.", names)
        self.assertIn("new.example.", names)
        self.assertNotIn("old.example.", names)
        # Buffer span (kept items) = 25min, requested = 60min → coverage
        # is incomplete. The endpoint reports honestly: partial=True.
        self.assertEqual(out["requested_window_seconds"], 3600)
        self.assertTrue(out["buffer_span_seconds"] < 3600)
        self.assertTrue(out["partial"])

    def test_large_range_exceeds_buffer_marks_partial(self):
        now = self.NOON_EPOCH
        # 5 minutes of buffer vs 24h requested window.
        queries = [
            {"time": _hhmmss(now - 5 * 60), "type": "A", "name": "a.example."},
            {"time": _hhmmss(now - 1 * 60), "type": "A", "name": "b.example."},
        ]
        out = self._call(queries=queries, now_epoch=now, range_value="24h")
        self.assertEqual(out["requested_window_seconds"], 24 * 3600)
        self.assertLess(out["buffer_span_seconds"], out["requested_window_seconds"])
        self.assertTrue(out["partial"])

    def test_midnight_rollover_keeps_pre_midnight_item(self):
        # `now` = 2026-06-21 00:05:00 UTC, item logged 23:55:00 on the
        # previous day. The clamp (ts -= 86400) must place the item in
        # the previous day so it survives a 1h window.
        now = datetime(2026, 6, 21, 0, 5, 0, tzinfo=timezone.utc).timestamp()
        queries = [{"time": "23:55:00", "type": "A", "name": "preroll.example."}]
        out = self._call(queries=queries, now_epoch=int(now), range_value="1h")
        names = [q["name"] for q in out["items"]]
        self.assertIn("preroll.example.", names,
                      "pre-midnight item dropped — UTC rollover clamp regressed")

    def test_unparseable_timestamp_preserved_and_marks_partial(self):
        now = self.NOON_EPOCH
        queries = [
            {"time": "??:??:??", "type": "A", "name": "ghost.example."},
        ]
        out = self._call(queries=queries, now_epoch=now, range_value="1h")
        names = [q["name"] for q in out["items"]]
        self.assertIn("ghost.example.", names)
        # No parseable timestamps → cannot prove coverage → partial=True.
        self.assertTrue(out["partial"])
        self.assertEqual(out["buffer_span_seconds"], 0)


class DnsMetricsSourceEnvelopeTest(unittest.TestCase):
    def test_empty_persisted_and_no_live_returns_source_none(self):
        # Simulate empty DB (no events, no samples) AND no live stats.
        with patch.object(metrics_service, "_get_persisted_dns_metrics", return_value=[]), \
             patch.object(metrics_service, "get_instance_real_stats", return_value=[]):
            rows, source = metrics_service.get_dns_metrics_with_source(
                hours=6, instance=None, qtype=None, range_value=None, db=object(),
            )
        self.assertEqual(rows, [], "must NOT fabricate a synthetic [0,0] point")
        self.assertEqual(source, "none")

    def test_persisted_rows_return_source_persisted(self):
        fake_rows = [{
            "timestamp": "2026-06-21T12:00:00Z",
            "timestamp_utc": "2026-06-21T12:00:00Z",
            "instance": "all", "qtype": "all",
            "qps": 1.5, "total_queries": 90, "latency_ms": 12.0,
            "servfail": 0, "nxdomain": 1, "refused": 0, "noerror": 89,
            "cache_hit_ratio": 78, "cache_hits": 70, "cache_misses": 20,
        }]
        with patch.object(metrics_service, "_get_persisted_dns_metrics", return_value=fake_rows):
            rows, source = metrics_service.get_dns_metrics_with_source(
                hours=6, instance=None, qtype=None, range_value=None, db=object(),
            )
        self.assertEqual(source, "persisted")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["total_queries"], 90)


if __name__ == "__main__":
    unittest.main()
