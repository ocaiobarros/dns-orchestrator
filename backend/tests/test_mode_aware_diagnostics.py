import unittest
from unittest.mock import patch

from app.api.routes import healthcheck as healthcheck_route
from app.executors.command_catalog import get_runtime_command_catalog
from app.services import diagnostics_service
from app.services import healthcheck_service


class ModeAwareDiagnosticsTest(unittest.TestCase):
    @patch("app.executors.command_catalog._read_current_operation_mode", return_value="simple")
    @patch("app.executors.command_catalog._discover_runtime_instances", return_value=[
        {
            "name": "unbound01",
            "bind_ips": ["100.127.255.180"],
            "control_interface": "127.0.0.11",
            "control_port": 8953,
        },
        {
            "name": "unbound02",
            "bind_ips": ["100.127.255.190"],
            "control_interface": "127.0.0.12",
            "control_port": 8953,
        },
    ])
    def test_runtime_catalog_hides_vip_checks_and_uses_real_simple_listeners(self, *_mocks):
        catalog = get_runtime_command_catalog()

        self.assertIn("dns-dig-listener-100-127-255-180", catalog)
        self.assertIn("dns-dig-listener-100-127-255-190", catalog)
        self.assertNotIn("dns-dig-listener-101", catalog)
        self.assertNotIn("dns-dig-listener-102", catalog)
        self.assertNotIn("dns-vip-probe-4225", catalog)
        self.assertNotIn("dns-vip-probe-4226", catalog)

    @patch("app.api.routes.healthcheck.get_deploy_state", return_value={"operationMode": "simple"})
    @patch("app.api.routes.healthcheck.check_vip_health", return_value={"bind_ip": "4.2.2.5"})
    @patch("app.api.routes.healthcheck.check_all_instances", return_value={"healthy": 2, "total": 2, "instances": []})
    def test_healthcheck_route_skips_vip_in_simple_mode(self, _check_all, _check_vip, _deploy_state):
        result = healthcheck_route.healthcheck_all(None)
        self.assertNotIn("vip", result)

    @patch("app.services.diagnostics_service._safe_run")
    @patch("app.services.healthcheck_service._discover_instances", return_value=[
        {"name": "unbound01", "bind_ips": ["100.127.255.180"], "port": 53},
        {"name": "unbound02", "bind_ips": ["100.127.255.190"], "port": 53},
    ])
    @patch("app.services.deploy_service.get_deploy_state", return_value={"operationMode": "simple", "frontendDnsIp": "172.250.40.11"})
    def test_reachability_uses_active_simple_topology_without_legacy_ips(self, _deploy_state, _discover, mock_run):
        mock_run.return_value = {"exit_code": 0, "stdout": "1 packets transmitted, 1 received, time=1.1", "stderr": ""}

        results = diagnostics_service.check_reachability()
        targets = {item["target"] for item in results}

        self.assertIn("172.250.40.11", targets)
        self.assertIn("100.127.255.180", targets)
        self.assertIn("100.127.255.190", targets)
        self.assertNotIn("100.127.255.101", targets)
        self.assertNotIn("100.127.255.102", targets)
        self.assertNotIn("191.243.128.205", targets)
        self.assertNotIn("191.243.128.206", targets)

    def test_healthcheck_discovers_real_root_forwarders_from_deployed_unbound_configs(self):
        config = '''server:
    interface: 100.127.255.101

forward-zone:
    name: "."
    forward-addr: 8.8.8.8
    forward-addr: 1.1.1.1

forward-zone:
    name: "corp.local"
    forward-addr: 10.0.0.10
'''
        import tempfile
        import os

        with tempfile.TemporaryDirectory() as temp_dir:
            path = os.path.join(temp_dir, "unbound01.conf")
            with open(path, "w", encoding="utf-8") as fp:
                fp.write(config)

            forwards = healthcheck_service.discover_root_forward_addresses(f"{temp_dir}/unbound*.conf")

        self.assertEqual(forwards, ["8.8.8.8", "1.1.1.1"])


if __name__ == "__main__":
    unittest.main()