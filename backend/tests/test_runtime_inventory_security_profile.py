from app.services import runtime_inventory_service as inventory


LEGACY_RULESET = """
table ip nat {
    chain PREROUTING {
        type nat hook prerouting priority dstnat; policy accept;
        ip daddr 4.2.2.5 udp dport 53 dnat to 100.126.0.1:53
    }
}
"""

HARDENED_RULESET_V4 = """
table ip filter {
    chain INPUT {
        type filter hook input priority filter; policy drop;
        udp dport 53 limit rate 1000/second accept
    }
}
table ip nat {
    chain PREROUTING { }
}
"""

HARDENED_RULESET_V6_ONLY = """
table ip6 filter {
    chain INPUT {
        type filter hook input priority filter; policy drop;
        accept
    }
}
"""


def _patch_nft(monkeypatch, ruleset: str, exit_code: int = 0):
    def fake_safe_run(executable, args, timeout=10, use_privilege=False):
        if executable == "nft" and args == ["list", "ruleset"]:
            return {"exit_code": exit_code, "stdout": ruleset, "stderr": "", "duration_ms": 0}
        return {"exit_code": 0, "stdout": "", "stderr": "", "duration_ms": 0}
    monkeypatch.setattr(inventory, "_safe_run", fake_safe_run)


def test_security_profile_legacy_when_no_filter_table(monkeypatch):
    _patch_nft(monkeypatch, LEGACY_RULESET)
    sec = inventory.discover_security_profile()
    assert sec["profile"] == "legacy"
    assert sec["filter_table_present"] is False
    assert sec["rate_limit_present"] is False


def test_security_profile_hardened_when_ip_filter_present(monkeypatch):
    _patch_nft(monkeypatch, HARDENED_RULESET_V4)
    sec = inventory.discover_security_profile()
    assert sec["profile"] == "isp-hardened"
    assert sec["filter_table_present"] is True
    assert sec["rate_limit_present"] is True


def test_security_profile_hardened_when_only_ip6_filter_present(monkeypatch):
    _patch_nft(monkeypatch, HARDENED_RULESET_V6_ONLY)
    sec = inventory.discover_security_profile()
    assert sec["profile"] == "isp-hardened"
    assert sec["filter_table_present"] is True


def test_security_profile_defaults_to_legacy_when_nft_fails(monkeypatch):
    _patch_nft(monkeypatch, "", exit_code=1)
    sec = inventory.discover_security_profile()
    assert sec["profile"] == "legacy"
    assert sec["filter_table_present"] is False


def test_full_inventory_exposes_security_section(monkeypatch):
    _patch_nft(monkeypatch, LEGACY_RULESET)
    monkeypatch.setattr(inventory, "discover_unbound_instances", lambda: [])
    monkeypatch.setattr(inventory, "discover_vips", lambda: [])
    monkeypatch.setattr(inventory, "discover_sticky_sets", lambda: [])
    monkeypatch.setattr(inventory, "discover_dns_listeners", lambda: [])
    monkeypatch.setattr(inventory, "discover_frr_config", lambda: {})
    monkeypatch.setattr(inventory, "_discover_hostname", lambda: "vdns-02")
    monkeypatch.setattr(inventory, "_discover_network", lambda: {})

    full = inventory.get_full_inventory()
    assert "security" in full
    assert full["security"]["profile"] == "legacy"
    assert full["security"]["filter_table_present"] is False
