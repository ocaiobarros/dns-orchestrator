"""
DNS Control — Input Validators for Command Execution
Validates parameters before passing to command runner.
"""

import re


def validate_ip(value: str) -> bool:
    pattern = r"^(\d{1,3}\.){3}\d{1,3}$"
    if not re.match(pattern, value):
        return False
    octets = value.split(".")
    return all(0 <= int(o) <= 255 for o in octets)


def validate_cidr(value: str) -> bool:
    if "/" not in value:
        return False
    ip, prefix = value.rsplit("/", 1)
    if not validate_ip(ip):
        return False
    try:
        p = int(prefix)
        return 0 <= p <= 32
    except ValueError:
        return False


def validate_interface_name(value: str) -> bool:
    return bool(re.match(r"^[a-zA-Z0-9._-]{1,16}$", value))


def validate_service_name(value: str) -> bool:
    return bool(re.match(r"^[a-zA-Z0-9@._-]{1,64}$", value))


def validate_domain(value: str) -> bool:
    return bool(re.match(r"^[a-zA-Z0-9.-]{1,253}$", value))


def validate_port(value: int) -> bool:
    return 1 <= value <= 65535
