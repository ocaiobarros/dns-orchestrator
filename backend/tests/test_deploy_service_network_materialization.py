import unittest
from unittest.mock import patch

from app.services import deploy_service


def _ok_result(executable: str, args: list[str], timeout: int = 30, use_privilege: bool = False, **kwargs):
    return {
        "exit_code": 0,
        "stdout": "",
        "stderr": "",
        "duration_ms": 0,
        "executed_privileged": use_privilege,
        "command": " ".join([executable] + args),
    }


class DeployServiceNetworkMaterializationTest(unittest.TestCase):
    def test_materialize_network_prefers_post_up_sh_on_fresh_install(self):
        calls: list[tuple[str, list[str], bool]] = []

        def fake_isfile(path: str) -> bool:
            return path == "/etc/network/post-up.sh"

        def fake_run_command(executable: str, args: list[str], timeout: int = 30, use_privilege: bool = False, **kwargs):
            calls.append((executable, args, use_privilege))
            result = _ok_result(executable, args, timeout=timeout, use_privilege=use_privilege, **kwargs)
            result["stdout"] = "post-up executado"
            return result

        with patch.object(deploy_service.os.path, "isfile", side_effect=fake_isfile), patch.object(
            deploy_service, "run_command", side_effect=fake_run_command
        ):
            result = deploy_service._materialize_network({"instances": []})

        self.assertEqual(result["status"], "success")
        self.assertIn("post-up executado", result["output"])
        self.assertEqual(calls, [("/etc/network/post-up.sh", [], True)])

    def test_materialize_network_uses_normalized_bind_ip_when_scripts_are_missing(self):
        calls: list[tuple[str, list[str], bool]] = []
        payload = {
            "operationMode": "simple",
            "instances": [
                {"name": "unbound01", "bindIp": "100.127.255.105"},
                {"name": "unbound02", "bindIp": "100.127.255.106"},
                {"name": "loopback-only", "bindIp": "127.0.0.1"},
            ],
        }

        def fake_run_command(executable: str, args: list[str], timeout: int = 30, use_privilege: bool = False, **kwargs):
            calls.append((executable, args, use_privilege))
            return _ok_result(executable, args, timeout=timeout, use_privilege=use_privilege, **kwargs)

        with patch.object(deploy_service.os.path, "isfile", return_value=False), patch.object(
            deploy_service, "run_command", side_effect=fake_run_command
        ):
            result = deploy_service._materialize_network(payload)

        self.assertEqual(result["status"], "success")
        self.assertIn("2 IP(s) materializados em lo0", result["output"])
        self.assertIn(("ip", ["link", "add", "lo0", "type", "dummy"], True), calls)
        self.assertIn(("ip", ["link", "set", "lo0", "up"], True), calls)
        self.assertIn(("ip", ["addr", "add", "100.127.255.105/32", "dev", "lo0"], True), calls)
        self.assertIn(("ip", ["addr", "add", "100.127.255.106/32", "dev", "lo0"], True), calls)
        self.assertNotIn(("ip", ["addr", "add", "127.0.0.1/32", "dev", "lo0"], True), calls)


if __name__ == "__main__":
    unittest.main()