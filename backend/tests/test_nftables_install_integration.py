import os
import pwd
import grp
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from app.services import deploy_service


def _owner_group(path: str) -> str:
    st = os.stat(path)
    return f"{pwd.getpwuid(st.st_uid).pw_name}:{grp.getgrgid(st.st_gid).gr_name}"


def _run_local_command(executable: str, args: list[str], timeout: int = 30, stdin_data: str | None = None, use_privilege: bool = False):
    cmd = [executable] + args
    result = subprocess.run(
        cmd,
        input=stdin_data,
        capture_output=True,
        text=True,
        timeout=timeout,
        shell=False,
    )
    return {
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "duration_ms": 0,
        "executed_privileged": use_privilege,
        "command": " ".join(cmd),
    }


@unittest.skipUnless(os.geteuid() == 0, "requer ambiente root para validar owner root:root real")
class NftablesInstallIntegrationTest(unittest.TestCase):
    def test_apply_like_install_writes_root_owned_nftables_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            staging_dir = os.path.join(tmpdir, "staging")
            target_path = os.path.join(tmpdir, "etc", "nftables.d", "5000-test.nft")
            staged_path = os.path.join(staging_dir, target_path.lstrip("/"))
            os.makedirs(os.path.dirname(staged_path), exist_ok=True)
            with open(staged_path, "w") as fh:
                fh.write("table ip nat {}\n")

            with patch.object(deploy_service, "run_command", side_effect=_run_local_command):
                result = deploy_service._install_file_from_staging(staging_dir, target_path, "0644")
                report = deploy_service._collect_nftables_owner_report([target_path])

            self.assertEqual(result["exit_code"], 0, result)
            self.assertEqual(_owner_group(target_path), "root:root")
            self.assertEqual(report["non_root"], [], report)

    def test_rollback_like_restore_uses_same_install_path_and_keeps_root_owner(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            backup_file = os.path.join(tmpdir, "backup-5000-test.nft")
            target_path = os.path.join(tmpdir, "etc", "nftables.d", "5000-test.nft")
            os.makedirs(os.path.dirname(backup_file), exist_ok=True)
            with open(backup_file, "w") as fh:
                fh.write("table ip nat { chain PREROUTING {} }\n")

            with patch.object(deploy_service, "run_command", side_effect=_run_local_command):
                result = deploy_service._install_file_to_target(backup_file, target_path, "0644")
                report = deploy_service._collect_nftables_owner_report([target_path])

            self.assertEqual(result["exit_code"], 0, result)
            self.assertEqual(_owner_group(target_path), "root:root")
            self.assertEqual(report["non_root"], [], report)


if __name__ == "__main__":
    unittest.main()