"""
Regression tests for the TSDB proxy (GATE-RETENÇÃO opção c):
  * Allowlist rejection (no raw PromQL accepted).
  * Honest degradation: not configured / unreachable / empty window.
  * Adaptive step calculation (1h vs 72h).
  * Auth header is sent upstream but never echoed back to the client.
  * Frontend routing rule (window > 1h ⇒ proxy) is exercised via the
    `query_metric` / `query_dns_chart_bundle` entrypoints.
"""

import os
import unittest
from unittest.mock import patch, MagicMock

from app.services import tsdb_proxy_service as tsdb


class StepAdaptiveTest(unittest.TestCase):
    def test_step_1h_is_short(self):
        # 1h / 400 ≈ 9s → floor 10s
        self.assertEqual(tsdb.compute_step_seconds(3600), 10)

    def test_step_72h_caps_growth(self):
        # 72h / 400 ≈ 648s → snaps to 900s (15m)
        s = tsdb.compute_step_seconds(72 * 3600)
        self.assertGreaterEqual(s, 600)
        self.assertLessEqual(s, 1800)
        # Total points = window/step → bounded between ~150 and 500
        pts = (72 * 3600) // s
        self.assertGreaterEqual(pts, 144)
        self.assertLessEqual(pts, 500)


class AllowlistTest(unittest.TestCase):
    def test_unknown_metric_rejected(self):
        with self.assertRaises(ValueError):
            tsdb.query_metric("rm -rf /", "1h", None)

    def test_promql_injection_via_metric_rejected(self):
        with self.assertRaises(ValueError):
            tsdb.query_metric('sum(rate(secret_metric[1m]))', "1h", None)

    def test_unknown_window_rejected(self):
        with self.assertRaises(ValueError):
            tsdb.query_metric("qps", "999h", None)


class DegradationTest(unittest.TestCase):
    def test_not_configured_returns_honest_empty(self):
        with patch.dict(os.environ, {"DNS_CONTROL_PROMETHEUS_QUERY_URL": ""}, clear=False):
            out = tsdb.query_metric("qps", "24h", None, now_epoch=1782388800)
        self.assertEqual(out["rows"], [])
        self.assertFalse(out["source_available"])
        self.assertTrue(out["degraded"])
        self.assertEqual(out["source"], "none")
        self.assertEqual(out["reason"], "não configurado")

    def test_upstream_unreachable_marks_indisponivel(self):
        env = {"DNS_CONTROL_PROMETHEUS_QUERY_URL": "http://prom.local:9090"}
        with patch.dict(os.environ, env, clear=False), \
             patch("app.services.tsdb_proxy_service.httpx.Client") as mclient:
            inst = mclient.return_value.__enter__.return_value
            import httpx as _h
            inst.get.side_effect = _h.RequestError("boom", request=None)
            out = tsdb.query_metric("qps", "6h", None, now_epoch=1782388800)
        self.assertFalse(out["source_available"])
        self.assertTrue(out["degraded"])
        self.assertEqual(out["reason"], "indisponível")
        self.assertEqual(out["error"], "upstream_unreachable")

    def test_empty_window_returns_rows_empty_but_source_tsdb(self):
        env = {"DNS_CONTROL_PROMETHEUS_QUERY_URL": "http://prom.local:9090"}
        fake = MagicMock(status_code=200)
        fake.json.return_value = {"status": "success", "data": {"result": []}}
        with patch.dict(os.environ, env, clear=False), \
             patch("app.services.tsdb_proxy_service.httpx.Client") as mclient:
            inst = mclient.return_value.__enter__.return_value
            inst.get.return_value = fake
            out = tsdb.query_metric("qps", "6h", None, now_epoch=1782388800)
        self.assertEqual(out["rows"], [])
        self.assertEqual(out["source"], "tsdb")
        self.assertEqual(out["reason"], "sem dados na janela")


class SecurityTest(unittest.TestCase):
    def test_auth_header_sent_upstream_but_never_in_response(self):
        env = {
            "DNS_CONTROL_PROMETHEUS_QUERY_URL": "http://prom.local:9090",
            "DNS_CONTROL_PROMETHEUS_QUERY_AUTH_HEADER": "Bearer SECRET-DO-NOT-LEAK",
        }
        fake = MagicMock(status_code=200)
        fake.json.return_value = {
            "status": "success",
            "data": {"result": [{
                "metric": {"instance": "unbound-1"},
                "values": [[1782388800, "12.5"], [1782388810, "13.0"]],
            }]},
        }
        with patch.dict(os.environ, env, clear=False), \
             patch("app.services.tsdb_proxy_service.httpx.Client") as mclient:
            inst = mclient.return_value.__enter__.return_value
            inst.get.return_value = fake
            out = tsdb.query_metric("qps", "6h", None, now_epoch=1782388800)
            _args, kwargs = inst.get.call_args
        # Auth header MUST have been forwarded upstream
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer SECRET-DO-NOT-LEAK")
        # ...but never echoed back to the client
        flat = repr(out)
        self.assertNotIn("SECRET-DO-NOT-LEAK", flat)
        self.assertNotIn("Authorization", flat)
        self.assertNotIn("auth_header", flat)

    def test_instance_label_value_is_quoted_not_raw_promql(self):
        env = {"DNS_CONTROL_PROMETHEUS_QUERY_URL": "http://prom.local:9090"}
        fake = MagicMock(status_code=200)
        fake.json.return_value = {"status": "success", "data": {"result": []}}
        with patch.dict(os.environ, env, clear=False), \
             patch("app.services.tsdb_proxy_service.httpx.Client") as mclient:
            inst = mclient.return_value.__enter__.return_value
            inst.get.return_value = fake
            # Attempted injection in `instance` should be escaped, not
            # break out of the quoted label value.
            tsdb.query_metric("qps", "6h", 'evil"} or up{', now_epoch=1782388800)
            _args, kwargs = inst.get.call_args
        promql = kwargs["params"]["query"]
        # The escaped instance value must appear inside instance="...";
        # the closing brace must NOT escape early.
        self.assertIn('instance="evil\\"} or up{"', promql)
        # And the surrounding selector still closes properly.
        self.assertTrue(promql.count("{") == promql.count("}"))


class BundleTest(unittest.TestCase):
    def test_bundle_propagates_not_configured(self):
        with patch.dict(os.environ, {"DNS_CONTROL_PROMETHEUS_QUERY_URL": ""}, clear=False):
            out = tsdb.query_dns_chart_bundle("24h", None, now_epoch=1782388800)
        self.assertEqual(out["rows"], [])
        self.assertFalse(out["source_available"])
        self.assertEqual(out["source"], "none")
        self.assertEqual(out["reason"], "não configurado")


if __name__ == "__main__":
    unittest.main()
