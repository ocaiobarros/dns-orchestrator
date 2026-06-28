"""Tests for IPv6 listener separation in discover_unbound_instances."""

from __future__ import annotations

from unittest.mock import patch

from app.services import runtime_inventory_service as ris


def _systemctl_stdout(names: list[str]) -> str:
    return "\n".join(f"  {n}.service                loaded active running x" for n in names)


def _parse_conf(bind_ips: list[str]):
    return {
        "bind_ips": bind_ips,
        "port": 53,
        "control_interface": "::1",
        "control_port": 8953,
        "outgoing_ips": [],
        "config_path": "/etc/unbound/unbound01.conf",
        "tuning": {},
    }


def test_dual_stack_bind_splits_ipv4_and_ipv6():
    with patch.object(ris, "_safe_run", return_value={"exit_code": 0, "stdout": _systemctl_stdout(["unbound01"])}), \
         patch.object(ris, "_parse_unbound_config", return_value=_parse_conf(
             ["100.126.255.101", "2001:db8:ffff:ffff:100:126:255:101"]
         )):
        instances = ris.discover_unbound_instances()

    assert len(instances) == 1
    inst = instances[0]
    assert inst["bind_ip"] == "100.126.255.101"
    assert inst["bind_ipv6"] == "2001:db8:ffff:ffff:100:126:255:101"


def test_ipv6_first_in_list_still_picks_ipv4_for_bind_ip():
    with patch.object(ris, "_safe_run", return_value={"exit_code": 0, "stdout": _systemctl_stdout(["unbound02"])}), \
         patch.object(ris, "_parse_unbound_config", return_value=_parse_conf(
             ["2001:db8::5", "100.126.255.102"]
         )):
        inst = ris.discover_unbound_instances()[0]
    assert inst["bind_ip"] == "100.126.255.102"
    assert inst["bind_ipv6"] == "2001:db8::5"


def test_loopback_and_link_local_ipv6_excluded():
    with patch.object(ris, "_safe_run", return_value={"exit_code": 0, "stdout": _systemctl_stdout(["unbound03"])}), \
         patch.object(ris, "_parse_unbound_config", return_value=_parse_conf(
             ["100.126.255.103", "::1", "fe80::1", "2001:db8::abcd"]
         )):
        inst = ris.discover_unbound_instances()[0]
    assert inst["bind_ipv6"] == "2001:db8::abcd"


def test_ipv4_only_leaves_bind_ipv6_empty():
    with patch.object(ris, "_safe_run", return_value={"exit_code": 0, "stdout": _systemctl_stdout(["unbound04"])}), \
         patch.object(ris, "_parse_unbound_config", return_value=_parse_conf(
             ["100.126.255.104"]
         )):
        inst = ris.discover_unbound_instances()[0]
    assert inst["bind_ip"] == "100.126.255.104"
    assert inst["bind_ipv6"] == ""
