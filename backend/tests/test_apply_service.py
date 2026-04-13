import unittest
from unittest.mock import patch

from app.services.apply_service import execute_apply


class ApplyServiceCompatibilityTest(unittest.TestCase):
    def test_execute_apply_delegates_to_execute_deploy(self):
        payload = {"instances": [{"name": "unbound01"}]}
        expected = {
            "id": "deploy-123",
            "success": False,
            "status": "failed",
            "steps": [],
            "stdout": "",
            "stderr": "boom",
            "exit_code": 1,
        }

        with patch("app.services.apply_service.execute_deploy", return_value=expected) as mocked:
            result = execute_apply(payload, scope="nftables", dry_run=True)

        mocked.assert_called_once_with(
            payload=payload,
            scope="nftables",
            dry_run=True,
            operator="legacy-apply",
        )
        self.assertEqual(result, expected)


if __name__ == "__main__":
    unittest.main()