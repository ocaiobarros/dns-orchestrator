import tempfile
import unittest
from unittest.mock import patch

from app.services import deploy_service


def _ok_result(executable: str, args: list[str], timeout: int = 30, use_privilege: bool = False, **kwargs):
    return {
        "exit_code": 0,
        "stdout": "active" if executable == "systemctl" and args[:1] == ["is-active"] else "",
        "stderr": "",
        "duration_ms": 0,
        "executed_privileged": use_privilege,
        "command": " ".join([executable] + args),
    }


class DeployServiceNftablesApplyTest(unittest.TestCase):
    def test_compatible_nftables_master_is_preserved_even_if_whitespace_differs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source_path = f"{temp_dir}/source-nftables.conf"
            target_path = f"{temp_dir}/target-nftables.conf"

            with open(source_path, "w", encoding="utf-8") as fp:
                fp.write("#!/usr/sbin/nft -f\n\nflush ruleset\ninclude \"/etc/nftables.d/*.nft\"\n")

            with open(target_path, "w", encoding="utf-8") as fp:
                fp.write("#!/usr/sbin/nft -f\nflush ruleset\ninclude \"/etc/nftables.d/*.nft\"\n")

            self.assertTrue(
                deploy_service._normalize_stable_runtime_base_content("/etc/nftables.conf", open(source_path, encoding="utf-8").read())
                == deploy_service._normalize_stable_runtime_base_content("/etc/nftables.conf", open(target_path, encoding="utf-8").read())
            )

    def test_execute_deploy_applies_generated_nftables_master_file_on_fresh_install(self):
        payload = {
            "operationMode": "simple",
            "frontendDnsIp": "172.250.40.11",
            "instances": [
                {"name": "unbound01", "bindIp": "100.127.255.105", "controlInterface": "127.0.0.11", "controlPort": 8953},
                {"name": "unbound02", "bindIp": "100.127.255.106", "controlInterface": "127.0.0.12", "controlPort": 8953},
            ],
        }
        normalized = deploy_service.normalize_payload(payload)
        files = [
            {"path": "/etc/nftables.conf", "content": "#!/usr/sbin/nft -f\nflush ruleset\ninclude \"/etc/nftables.d/*.nft\"\n", "permissions": "0644", "owner": "root:root"},
            {"path": "/etc/nftables.d/5000-local-table.nft", "content": "table ip nat {\n}\n", "permissions": "0644", "owner": "root:root"},
            {"path": "/usr/lib/systemd/system/unbound01.service", "content": "[Unit]\nDescription=unbound01\n", "permissions": "0644", "owner": "root:root"},
            {"path": "/usr/lib/systemd/system/unbound02.service", "content": "[Unit]\nDescription=unbound02\n", "permissions": "0644", "owner": "root:root"},
        ]
        validation_files = [{
            "path": "/etc/nftables.validate.conf",
            "content": "table ip nat { chain PREROUTING { type nat hook prerouting priority dstnat; policy accept; } }\n",
            "permissions": "0644",
            "owner": "root:root",
        }]
        installed_paths: list[str] = []

        def fake_run_command(executable: str, args: list[str], timeout: int = 30, use_privilege: bool = False, **kwargs):
            return _ok_result(executable, args, timeout=timeout, use_privilege=use_privilege, **kwargs)

        def fake_install_from_staging(staging_dir: str, target_path: str, permissions: str = "0644"):
            installed_paths.append(target_path)
            return {
                "exit_code": 0,
                "stdout": "OK",
                "stderr": "",
                "duration_ms": 0,
                "audit": {
                    "command": f"install {target_path}",
                    "effective_uid": 0,
                    "owner_after": "root:root",
                },
            }

        with tempfile.TemporaryDirectory() as temp_dir, \
            patch.object(deploy_service, "STAGING_ROOT", f"{temp_dir}/staging"), \
            patch.object(deploy_service, "BACKUP_ROOT", f"{temp_dir}/backups"), \
            patch.object(deploy_service, "validate_config", return_value={"valid": True, "errors": [], "normalized": normalized}), \
            patch.object(deploy_service, "generate_preview", return_value=files), \
            patch.object(deploy_service, "generate_simple_nftables_config", return_value=validation_files), \
            patch.object(deploy_service, "run_command", side_effect=fake_run_command), \
            patch.object(deploy_service, "_install_file_from_staging", side_effect=fake_install_from_staging), \
            patch.object(deploy_service, "_collect_nftables_owner_report", return_value={"report": [], "non_root": []}), \
            patch.object(deploy_service, "_run_health_checks", return_value=[]), \
            patch.object(deploy_service.glob, "glob", return_value=[]):
            result = deploy_service.execute_deploy(payload=payload, scope="full", dry_run=False, operator="test")

        self.assertTrue(result["success"])
        self.assertIn("/etc/nftables.conf", installed_paths)
        self.assertIn("/etc/nftables.d/5000-local-table.nft", installed_paths)

    def test_valid_existing_nftables_master_is_preserved_on_read_only_failure(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source_path = f"{temp_dir}/source-nftables.conf"
            target_path = f"{temp_dir}/target-nftables.conf"

            with open(source_path, "w", encoding="utf-8") as fp:
                fp.write("#!/usr/sbin/nft -f\n\nflush ruleset\ninclude \"/etc/nftables.d/*.nft\"\n")

            with open(target_path, "w", encoding="utf-8") as fp:
                fp.write("#!/usr/sbin/nft -f\nflush ruleset\ninclude \"/etc/nftables.d/*.nft\"\n")

            with patch.object(deploy_service, "run_command", return_value={
                "exit_code": 1,
                "stdout": "",
                "stderr": "install: cannot remove '/etc/nftables.conf': Read-only file system",
                "duration_ms": 0,
                "executed_privileged": True,
                "command": "install ...",
            }):
                result = deploy_service._install_file_to_target(source_path, target_path, "0644")

            self.assertEqual(result["exit_code"], 0)
            self.assertEqual(result["stdout"], "UNCHANGED")
            self.assertIn("read-only stable base file preserved", result["command"])


if __name__ == "__main__":
    unittest.main()