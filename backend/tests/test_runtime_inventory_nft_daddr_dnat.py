from app.services import runtime_inventory_service as inventory


EXPANDED_RULESET = """
table ip nat {
    set ipv4_users_unbound01 {
        type ipv4_addr
        flags dynamic,timeout
        elements = { 4.2.2.5 timeout 19m59s, 10.31.3.23 timeout 18m }
    }

    chain PREROUTING {
        type nat hook prerouting priority dstnat; policy accept;
        ip daddr 4.2.2.5 tcp dport 53 counter packets 7 bytes 420 jump ipv4_tcp_dns
        ip daddr 4.2.2.5 udp dport 53 counter packets 11 bytes 660 jump ipv4_udp_dns
        ip daddr 45.232.10.10 tcp dport 443 counter packets 1 bytes 60 accept
    }

    chain ipv4_tcp_dns {
        counter packets 3 bytes 180 jump ipv4_dns_unbound01
    }

    chain ipv4_udp_dns {
        dnat to 100.126.0.2:53
    }

    chain ipv4_dns_unbound01 {
        dnat to 100.126.0.1:53
    }
}
"""


def test_expanded_daddr_jump_chain_dnat_marks_only_capture_destination():
    rules = inventory._discover_nft_daddr_dnat_correlations(EXPANDED_RULESET)

    dest_ips = {rule["dest_ip"] for rule in rules}
    backend_ips = {rule["backend_ip"] for rule in rules}

    assert dest_ips == {"4.2.2.5"}
    assert backend_ips == {"100.126.0.1", "100.126.0.2"}
    assert "10.31.3.23" not in dest_ips
    assert "100.126.0.1" not in dest_ips
    assert "45.232.10.10" not in dest_ips


def test_full_inventory_adds_runtime_captured_vip_without_sticky_clients(monkeypatch):
    def fake_safe_run(executable, args, timeout=10, use_privilege=False):
        if executable == "nft" and args == ["list", "ruleset"]:
            return {"exit_code": 0, "stdout": EXPANDED_RULESET, "stderr": "", "duration_ms": 0}
        return {"exit_code": 0, "stdout": "", "stderr": "", "duration_ms": 0}

    monkeypatch.setattr(inventory, "_safe_run", fake_safe_run)
    monkeypatch.setattr(inventory, "discover_unbound_instances", lambda: [
        {"instance_name": "unbound01", "bind_ips": ["100.126.0.1"], "outgoing_ips": ["45.232.10.10"]}
    ])
    monkeypatch.setattr(inventory, "discover_vips", lambda: [])
    monkeypatch.setattr(inventory, "discover_sticky_sets", lambda: [])
    monkeypatch.setattr(inventory, "discover_dns_listeners", lambda: [{"ip": "100.126.0.1", "port": 53}])
    monkeypatch.setattr(inventory, "discover_frr_config", lambda: {})
    monkeypatch.setattr(inventory, "_discover_hostname", lambda: "vdns-02")
    monkeypatch.setattr(inventory, "_discover_network", lambda: {})

    full = inventory.get_full_inventory()
    vip_by_ip = {vip["ip"]: vip for vip in full["vips"]}

    assert vip_by_ip["4.2.2.5"]["capture_mode"] == "dnat"
    assert "10.31.3.23" not in vip_by_ip
    assert "100.126.0.1" not in vip_by_ip
    assert "45.232.10.10" not in vip_by_ip
    assert set(full["vip_backend_map"]["4.2.2.5"][i]["backend_ip"] for i in range(len(full["vip_backend_map"]["4.2.2.5"]))) == {"100.126.0.1", "100.126.0.2"}