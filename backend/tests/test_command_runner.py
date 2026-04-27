import unittest

from app.executors.command_runner import run_command


class CommandRunnerTest(unittest.TestCase):
    def test_run_command_passes_stdin_data_to_process(self):
        result = run_command("bash", ["-c", "cat"], stdin_data="payload-from-stdin", timeout=5)

        self.assertEqual(result["exit_code"], 0, result)
        self.assertEqual(result["stdout"], "payload-from-stdin")


if __name__ == "__main__":
    unittest.main()