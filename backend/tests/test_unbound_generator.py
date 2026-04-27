import unittest

from app.generators.unbound_generator import generate_unbound_configs
from app.generators.nftables_simple_generator import generate_simple_nftables_config


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


class UnboundSecurityProfileTest(unittest.TestCase):
    def _make_payload(self, security_profile="isp-hardened"):
        return {
            "operationMode": "simple",
            "ipv4Address": "172.250.40.11/23",
            "enableIpv6": False,
            "threads": 4,
            "securityProfile": security_profile,
            "instances": [
                {
                    "name": "unbound01",
                    "bindIp": "100.127.255.120",
                    "controlInterface": "127.0.0.11",
                    "controlPort": 8953,
                },
            ],
            "_wizardConfig": {
                "operationMode": "simple",
                "ipv4Address": "172.250.40.11/23",
                "securityProfile": security_profile,
                "threads": 4,
            },
        }

    def test_legacy_profile_emits_open_resolver(self):
        files = generate_unbound_configs(self._make_payload("legacy"))
        content = next(f["content"] for f in files if f["path"] == "/etc/unbound/unbound01.conf")
        self.assertIn("access-control: 0.0.0.0/0 allow", content)
        self.assertNotIn("access-control: 127.0.0.0/8 allow", content)
        self.assertNotIn("access-control: 100.64.0.0/10 allow", content)

    def test_isp_hardened_profile_emits_restrictive_acl(self):
        files = generate_unbound_configs(self._make_payload("isp-hardened"))
        content = next(f["content"] for f in files if f["path"] == "/etc/unbound/unbound01.conf")
        self.assertIn("access-control: 127.0.0.0/8 allow", content)
        self.assertIn("access-control: 172.250.40.0/23 allow", content)
        self.assertIn("access-control: 100.64.0.0/10 allow", content)
        self.assertNotIn("access-control: 0.0.0.0/0 allow", content)

    def test_simple_nftables_filter_mirrors_implicit_unbound_host_acl(self):
        payload = self._make_payload("isp-hardened")
        payload["frontendDnsIp"] = "172.250.40.3"
        payload["accessControlIpv4"] = [{"network": "127.0.0.0/8", "action": "allow", "label": "Loopback"}]
        payload["_wizardConfig"]["frontendDnsIp"] = payload["frontendDnsIp"]
        payload["_wizardConfig"]["accessControlIpv4"] = payload["accessControlIpv4"]

        files = generate_simple_nftables_config(payload)
        content = next(f["content"] for f in files if f["path"] == "/etc/nftables.d/0060-filter-table-ipv4.nft")

        self.assertIn("ip saddr 172.250.40.0/23 udp dport 53 counter accept", content)
        self.assertIn("ip saddr 172.250.40.0/23 tcp dport 53 counter accept", content)
        self.assertIn("ip saddr 100.64.0.0/10 udp dport 53 counter accept", content)

    def test_isp_hardened_profile_honors_configured_acl_networks(self):
        payload = self._make_payload("isp-hardened")
        payload["accessControlIpv4"] = [
            {"network": "172.16.20.0/24", "action": "allow", "label": "Rede_Corporativa"},
            {"network": "172.16.50.0/24", "action": "allow", "label": "Rede_VoIP"},
        ]
        payload["_wizardConfig"]["accessControlIpv4"] = payload["accessControlIpv4"]

        files = generate_unbound_configs(payload)
        content = next(f["content"] for f in files if f["path"] == "/etc/unbound/unbound01.conf")

        self.assertIn("access-control: 172.16.20.0/24 allow", content)
        self.assertIn("access-control: 172.16.50.0/24 allow", content)

    def test_legacy_profile_with_ipv6_emits_open_v6(self):
        payload = self._make_payload("legacy")
        payload["enableIpv6"] = True
        payload["_wizardConfig"]["enableIpv6"] = True
        files = generate_unbound_configs(payload)
        content = next(f["content"] for f in files if f["path"] == "/etc/unbound/unbound01.conf")
        self.assertIn("access-control: 0.0.0.0/0 allow", content)
        self.assertIn("access-control: ::/0 allow", content)


if __name__ == "__main__":
    unittest.main()
