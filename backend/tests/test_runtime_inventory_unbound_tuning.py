from app.services import runtime_inventory_service as inventory


UNBOUND_CONF_REAL = """
server:
    verbosity: 1
    num-threads: 4
    interface: 100.126.0.1
    port: 53
    control-interface: 127.0.0.11
    control-port: 8953
    outgoing-interface: 45.232.10.10
    num-queries-per-thread: 2048
    msg-cache-size: 2g
    rrset-cache-size: 2G
    cache-min-ttl: 300
    cache-max-ttl: 7200
    serve-expired: yes
    serve-expired-ttl: 86400
    identity: "ns1.example"
    harden-dnssec-stripped: yes
    use-caps-for-id: no
"""

UNBOUND_CONF_MINIMAL = """
server:
    interface: 127.0.0.1
"""


def test_parse_unbound_config_extracts_full_tuning(monkeypatch):
    def fake_safe_run(executable, args, timeout=5, use_privilege=False):
        if executable == "cat":
            return {"exit_code": 0, "stdout": UNBOUND_CONF_REAL, "stderr": "", "duration_ms": 0}
        return {"exit_code": 0, "stdout": "", "stderr": "", "duration_ms": 0}

    monkeypatch.setattr(inventory, "_safe_run", fake_safe_run)
    cfg = inventory._parse_unbound_config("unbound01")

    assert cfg["bind_ips"] == ["100.126.0.1"]
    assert cfg["control_interface"] == "127.0.0.11"
    assert cfg["control_port"] == 8953
    assert cfg["outgoing_ips"] == ["45.232.10.10"]

    t = cfg["tuning"]
    assert t["num_threads"] == 4
    assert t["num_queries_per_thread"] == 2048
    assert t["msg_cache_size"] == "2g"
    assert t["rrset_cache_size"] == "2g"  # normalized from "2G"
    assert t["cache_min_ttl"] == 300
    assert t["cache_max_ttl"] == 7200
    assert t["serve_expired"] is True
    assert t["serve_expired_ttl"] == 86400
    assert t["identity"] == "ns1.example"
    assert t["harden_dnssec_stripped"] is True
    assert t["use_caps_for_id"] is False


def test_parse_unbound_config_minimal_has_empty_tuning(monkeypatch):
    def fake_safe_run(executable, args, timeout=5, use_privilege=False):
        return {"exit_code": 0, "stdout": UNBOUND_CONF_MINIMAL, "stderr": "", "duration_ms": 0}

    monkeypatch.setattr(inventory, "_safe_run", fake_safe_run)
    cfg = inventory._parse_unbound_config("unbound01")
    assert cfg["tuning"] == {}


def test_full_inventory_aggregates_first_instance_tuning(monkeypatch):
    monkeypatch.setattr(inventory, "discover_unbound_instances", lambda: [
        {"instance_name": "unbound01", "bind_ips": ["100.126.0.1"], "outgoing_ips": [],
         "tuning": {"num_threads": 4, "num_queries_per_thread": 2048,
                    "msg_cache_size": "2g", "rrset_cache_size": "2g"}},
        {"instance_name": "unbound02", "bind_ips": ["100.126.0.2"], "outgoing_ips": [],
         "tuning": {"num_threads": 4}},
    ])
    monkeypatch.setattr(inventory, "discover_vips", lambda: [])
    monkeypatch.setattr(inventory, "discover_sticky_sets", lambda: [])
    monkeypatch.setattr(inventory, "discover_dns_listeners", lambda: [])
    monkeypatch.setattr(inventory, "discover_frr_config", lambda: {})
    monkeypatch.setattr(inventory, "discover_security_profile", lambda: {"profile": "legacy", "filter_table_present": False, "rate_limit_present": False})
    monkeypatch.setattr(inventory, "_discover_hostname", lambda: "vdns-02")
    monkeypatch.setattr(inventory, "_discover_network", lambda: {})

    def fake_safe_run(executable, args, timeout=10, use_privilege=False):
        return {"exit_code": 0, "stdout": "", "stderr": "", "duration_ms": 0}
    monkeypatch.setattr(inventory, "_safe_run", fake_safe_run)

    full = inventory.get_full_inventory()
    assert full["tuning"]["num_threads"] == 4
    assert full["tuning"]["num_queries_per_thread"] == 2048
    assert full["tuning"]["msg_cache_size"] == "2g"
    assert full["tuning"]["rrset_cache_size"] == "2g"
