import unittest
from unittest.mock import patch, Mock

from app.executors.command_runner import _is_sudo_allowed, run_command


class CommandRunnerTest(unittest.TestCase):
    def test_run_command_passes_stdin_data_to_process(self):
        result = run_command("bash", ["-c", "cat"], stdin_data="payload-from-stdin", timeout=5)

        self.assertEqual(result["exit_code"], 0, result)
        self.assertEqual(result["stdout"], "payload-from-stdin")

    def test_nft_list_specific_table_is_privilege_allowlisted(self):
        self.assertTrue(_is_sudo_allowed("nft", ["list", "table", "ip", "nat"]))

    @patch("app.executors.command_runner.is_sudo_available", return_value=True)
    @patch("app.executors.command_runner.subprocess.run")
    def test_privileged_systemctl_uses_absolute_sudoers_path(self, mock_run, _mock_sudo):
        mock_run.return_value = Mock(returncode=0, stdout="", stderr="")

        result = run_command(
            "systemctl",
            ["list-units", "--all", "--type=service", "--no-pager", "--plain"],
            use_privilege=True,
        )

        self.assertEqual(result["exit_code"], 0, result)
        self.assertEqual(
            mock_run.call_args.args[0],
            ["sudo", "-n", "/usr/bin/systemctl", "list-units", "--all", "--type=service", "--no-pager", "--plain"],
        )


if __name__ == "__main__":
    unittest.main()