import unittest

from app.generators.unbound_generator import generate_unbound_configs


class UnboundGeneratorStructuralTest(unittest.TestCase):
    def _make_payload(self):
        return {
            "operationMode": "simple",
            "ipv4Address": "172.250.40.11/23",
            "enableIpv6": False,
            "threads": 4,
            "instances": [
                {
                    "name": "unbound01",
                    "bindIp": "100.127.255.120",
                    "controlInterface": "127.0.0.11",
                    "controlPort": 8953,
                },
                {
                    "name": "unbound02",
                    "bindIp": "100.127.255.130",
                    "controlInterface": "127.0.0.12",
                    "controlPort": 8953,
                },
            ],
            "adForwardZones": [
                {
                    "domain": "madeplant.local",
                    "dnsServers": ["172.250.40.254", "172.250.40.253"],
                }
            ],
            "_wizardConfig": {
                "operationMode": "simple",
                "ipv4Address": "172.250.40.11/23",
                "threads": 4,
                "adForwardZones": [
                    {
                        "domain": "madeplant.local",
                        "dnsServers": ["172.250.40.254", "172.250.40.253"],
                    }
                ],
            },
        }

    def test_generates_unique_pidfile_per_instance(self):
        files = generate_unbound_configs(self._make_payload())
        confs = {file["path"]: file["content"] for file in files if file["path"].startswith("/etc/unbound/unbound") and file["path"].endswith(".conf") and file["path"] != "/etc/unbound/unbound.conf"}

        self.assertIn('pidfile: "/var/run/unbound01.pid"', confs["/etc/unbound/unbound01.conf"])
        self.assertIn('pidfile: "/var/run/unbound02.pid"', confs["/etc/unbound/unbound02.conf"])
        self.assertNotIn('pidfile: "/var/run/unbound.pid"', confs["/etc/unbound/unbound01.conf"])
        self.assertNotIn('pidfile: "/var/run/unbound.pid"', confs["/etc/unbound/unbound02.conf"])

    def test_generates_single_server_block_with_anablock_inside_main_server(self):
        files = generate_unbound_configs(self._make_payload())
        content = next(file["content"] for file in files if file["path"] == "/etc/unbound/unbound01.conf")

        self.assertEqual(content.count("server:"), 1)
        self.assertIn("include: /etc/unbound/unbound-block-domains.conf", content)
        self.assertIn("include: /etc/unbound/anablock.conf", content)
        self.assertLess(content.index("include: /etc/unbound/anablock.conf"), content.index("remote-control:"))

    def test_generates_ad_forward_zones_with_multiple_dcs(self):
        files = generate_unbound_configs(self._make_payload())
        content = next(file["content"] for file in files if file["path"] == "/etc/unbound/unbound01.conf")

        self.assertIn('name: "madeplant.local"', content)
        self.assertIn('name: "_msdcs.madeplant.local"', content)
        self.assertEqual(content.count("forward-addr: 172.250.40.254"), 2)
        self.assertEqual(content.count("forward-addr: 172.250.40.253"), 2)

    def test_generates_only_main_private_domain_and_derived_acl(self):
        files = generate_unbound_configs(self._make_payload())
        content = next(file["content"] for file in files if file["path"] == "/etc/unbound/unbound01.conf")

        self.assertIn('private-domain: "madeplant.local"', content)
        self.assertNotIn('private-domain: "_msdcs.madeplant.local"', content)
        self.assertIn('access-control: 172.250.40.0/23 allow', content)


if __name__ == "__main__":
    unittest.main()
