from app.services import runtime_inventory_service as inventory


UNBOUND_WITH_INCLUDE = """
server:
    interface: 100.126.0.1
    include: /etc/unbound/unbound-block-domains.conf
    include: /etc/unbound/anablock.conf
"""

UNBOUND_WITHOUT_INCLUDE = """
server:
    interface: 100.126.0.1
"""


def _patch(monkeypatch, file_map: dict, blackhole_stdout: str = ""):
    """file_map: {path: stdout} — files that exist."""
    def fake_safe_run(executable, args, timeout=10, use_privilege=False):
        if executable == "cat" and len(args) == 1:
            path = args[0]
            if path in file_map:
                return {"exit_code": 0, "stdout": file_map[path], "stderr": "", "duration_ms": 0}
            return {"exit_code": 1, "stdout": "", "stderr": "No such file", "duration_ms": 0}
        if executable == "ip" and args[:2] == ["route", "show"]:
            return {"exit_code": 0, "stdout": blackhole_stdout, "stderr": "", "duration_ms": 0}
        return {"exit_code": 0, "stdout": "", "stderr": "", "duration_ms": 0}
    monkeypatch.setattr(inventory, "_safe_run", fake_safe_run)


def test_anablock_enabled_when_files_present_and_included(monkeypatch):
    _patch(monkeypatch, {
        "/etc/unbound/anablock.conf": "local-zone: \"blocked.example\" always_nxdomain\n",
        "/etc/unbound/unbound-block-domains.conf": "# managed by ops\n",
        "/etc/unbound/unbound01.conf": UNBOUND_WITH_INCLUDE,
    })
    ab = inventory.discover_anablock_state([
        {"instance_name": "unbound01", "config_path": "/etc/unbound/unbound01.conf"},
    ])
    assert ab["enabled"] is True
    assert ab["anablock_conf_present"] is True
    assert ab["block_domains_conf_present"] is True
    assert ab["included_in_unbound"] is True
    assert ab["ip_blocking"] is False


def test_anablock_disabled_when_no_files(monkeypatch):
    _patch(monkeypatch, {
        "/etc/unbound/unbound01.conf": UNBOUND_WITHOUT_INCLUDE,
    })
    ab = inventory.discover_anablock_state([
        {"instance_name": "unbound01", "config_path": "/etc/unbound/unbound01.conf"},
    ])
    assert ab["enabled"] is False
    assert ab["anablock_conf_present"] is False
    assert ab["included_in_unbound"] is False


def test_anablock_disabled_when_files_present_but_not_included(monkeypatch):
    _patch(monkeypatch, {
        "/etc/unbound/anablock.conf": "# orphan\n",
        "/etc/unbound/unbound01.conf": UNBOUND_WITHOUT_INCLUDE,
    })
    ab = inventory.discover_anablock_state([
        {"instance_name": "unbound01", "config_path": "/etc/unbound/unbound01.conf"},
    ])
    assert ab["anablock_conf_present"] is True
    assert ab["included_in_unbound"] is False
    assert ab["enabled"] is False


def test_anablock_ip_blocking_inferred_from_blackhole_routes(monkeypatch):
    _patch(
        monkeypatch,
        {"/etc/unbound/unbound01.conf": UNBOUND_WITHOUT_INCLUDE},
        blackhole_stdout="blackhole 198.51.100.0/24\nblackhole 203.0.113.7\n",
    )
    ab = inventory.discover_anablock_state([
        {"instance_name": "unbound01", "config_path": "/etc/unbound/unbound01.conf"},
    ])
    assert ab["ip_blocking"] is True
    assert ab["enabled"] is False  # ip_blocking alone doesn't enable AnaBlock


def test_full_inventory_exposes_anablock_section(monkeypatch):
    _patch(monkeypatch, {
        "/etc/unbound/anablock.conf": "local-zone: \"x\" always_nxdomain\n",
        "/etc/unbound/unbound01.conf": UNBOUND_WITH_INCLUDE,
    })
    monkeypatch.setattr(inventory, "discover_unbound_instances", lambda: [
        {"instance_name": "unbound01", "config_path": "/etc/unbound/unbound01.conf",
         "bind_ips": ["100.126.0.1"], "outgoing_ips": [], "tuning": {}},
    ])
    monkeypatch.setattr(inventory, "discover_vips", lambda: [])
    monkeypatch.setattr(inventory, "discover_sticky_sets", lambda: [])
    monkeypatch.setattr(inventory, "discover_dns_listeners", lambda: [])
    monkeypatch.setattr(inventory, "discover_frr_config", lambda: {})
    monkeypatch.setattr(inventory, "discover_security_profile", lambda: {"profile": "legacy", "filter_table_present": False, "rate_limit_present": False})
    monkeypatch.setattr(inventory, "_discover_hostname", lambda: "vdns-02")
    monkeypatch.setattr(inventory, "_discover_network", lambda: {})

    full = inventory.get_full_inventory()
    assert "anablock" in full
    assert full["anablock"]["enabled"] is True
