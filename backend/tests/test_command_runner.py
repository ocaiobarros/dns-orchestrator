import unittest

from app.executors.command_runner import _is_sudo_allowed, run_command


class CommandRunnerTest(unittest.TestCase):
    def test_run_command_passes_stdin_data_to_process(self):
        result = run_command("bash", ["-c", "cat"], stdin_data="payload-from-stdin", timeout=5)

        self.assertEqual(result["exit_code"], 0, result)
        self.assertEqual(result["stdout"], "payload-from-stdin")

    def test_nft_list_specific_table_is_privilege_allowlisted(self):
        self.assertTrue(_is_sudo_allowed("nft", ["list", "table", "ip", "nat"]))


if __name__ == "__main__":
    unittest.main()