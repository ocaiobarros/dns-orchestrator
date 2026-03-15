"""
DNS Control — Command Catalog
Defines all whitelisted diagnostic commands with their arguments.
Frontend selects by command ID; arguments are constructed server-side.

Multi-instance aware: unbound commands target each instance separately
via -s <control_ip>@<control_port> and -c <config_path>.
"""

from dataclasses import dataclass, field


@dataclass
class CommandDefinition:
    id: str
    name: str
    description: str
    category: str
    executable: str
    base_args: list[str] = field(default_factory=list)
    allowed_params: list[str] = field(default_factory=list)
    dangerous: bool = False
    timeout: int = 30
    requires_privilege: bool = False
    expected_failure_unprivileged: str = ""
    remediation_hint: str = ""

    def build_args(self, params: dict[str, str]) -> list[str]:
        args = list(self.base_args)
        for key in self.allowed_params:
            if key in params:
                args.append(params[key])
        return args


# ── Static catalog (non-instance-specific commands) ──

COMMAND_CATALOG: dict[str, CommandDefinition] = {
    # Systemctl — per instance
    "svc-status-unbound01": CommandDefinition(
        id="svc-status-unbound01", name="Status unbound01", description="Status do serviço unbound01",
        category="services", executable="systemctl", base_args=["status", "unbound01"],
    ),
    "svc-status-unbound02": CommandDefinition(
        id="svc-status-unbound02", name="Status unbound02", description="Status do serviço unbound02",
        category="services", executable="systemctl", base_args=["status", "unbound02"],
    ),
    "svc-status-frr": CommandDefinition(
        id="svc-status-frr", name="Status FRR", description="Status do serviço FRR (opcional conforme topologia)",
        category="services", executable="systemctl", base_args=["status", "frr"],
    ),

    # Network
    "net-interfaces": CommandDefinition(
        id="net-interfaces", name="Interfaces de rede", description="Lista todas as interfaces com IPs",
        category="network", executable="ip", base_args=["-br", "addr", "show"],
    ),
    "net-interfaces-detail": CommandDefinition(
        id="net-interfaces-detail", name="Interfaces detalhadas", description="Interfaces com todos os endereços",
        category="network", executable="ip", base_args=["addr", "show"],
    ),
    "net-routes": CommandDefinition(
        id="net-routes", name="Tabela de rotas", description="Mostra rotas do kernel",
        category="network", executable="ip", base_args=["route", "show"],
    ),
    "net-listening": CommandDefinition(
        id="net-listening", name="Portas em escuta", description="Mostra portas TCP/UDP em escuta",
        category="network", executable="ss", base_args=["-tulnp"],
    ),
    "net-connections": CommandDefinition(
        id="net-connections", name="Conexões ativas", description="Mostra conexões ativas",
        category="network", executable="ss", base_args=["-tnp"],
    ),

    # DNS — per-instance unbound-control
    "dns-unbound01-stats": CommandDefinition(
        id="dns-unbound01-stats", name="unbound01 stats", description="Estatísticas do unbound01",
        category="dns", executable="unbound-control",
        base_args=["-s", "127.0.0.11@8953", "-c", "/etc/unbound/unbound01.conf", "stats_noreset"],
        requires_privilege=True,
        expected_failure_unprivileged="Permission denied for unbound-control",
        remediation_hint="Ajustar permissão do socket ou usar execução via sudo controlado",
    ),
    "dns-unbound01-status": CommandDefinition(
        id="dns-unbound01-status", name="unbound01 status", description="Status detalhado do unbound01",
        category="dns", executable="unbound-control",
        base_args=["-s", "127.0.0.11@8953", "-c", "/etc/unbound/unbound01.conf", "status"],
        requires_privilege=True,
        expected_failure_unprivileged="Permission denied for unbound-control",
        remediation_hint="Ajustar permissão do socket ou usar execução via sudo controlado",
    ),
    "dns-unbound02-stats": CommandDefinition(
        id="dns-unbound02-stats", name="unbound02 stats", description="Estatísticas do unbound02",
        category="dns", executable="unbound-control",
        base_args=["-s", "127.0.0.12@8953", "-c", "/etc/unbound/unbound.conf.d/unbound02.conf", "stats_noreset"],
        requires_privilege=True,
        expected_failure_unprivileged="Permission denied for unbound-control",
        remediation_hint="Ajustar permissão do socket ou usar execução via sudo controlado",
    ),
    "dns-unbound02-status": CommandDefinition(
        id="dns-unbound02-status", name="unbound02 status", description="Status detalhado do unbound02",
        category="dns", executable="unbound-control",
        base_args=["-s", "127.0.0.12@8953", "-c", "/etc/unbound/unbound.conf.d/unbound02.conf", "status"],
        requires_privilege=True,
        expected_failure_unprivileged="Permission denied for unbound-control",
        remediation_hint="Ajustar permissão do socket ou usar execução via sudo controlado",
    ),
    # DNS resolution tests per listener
    "dns-dig-listener-101": CommandDefinition(
        id="dns-dig-listener-101", name="Dig @100.127.255.101", description="Testa resolução no listener 101",
        category="dns", executable="dig", base_args=["@100.127.255.101", "google.com", "+short", "+time=3", "+tries=1"],
    ),
    "dns-dig-listener-102": CommandDefinition(
        id="dns-dig-listener-102", name="Dig @100.127.255.102", description="Testa resolução no listener 102",
        category="dns", executable="dig", base_args=["@100.127.255.102", "google.com", "+short", "+time=3", "+tries=1"],
    ),
    "dns-dig-egress-205": CommandDefinition(
        id="dns-dig-egress-205", name="Dig @191.243.128.205", description="Testa resolução no IP público 205",
        category="dns", executable="dig", base_args=["@191.243.128.205", "google.com", "+short", "+time=3", "+tries=1"],
    ),
    "dns-dig-egress-206": CommandDefinition(
        id="dns-dig-egress-206", name="Dig @191.243.128.206", description="Testa resolução no IP público 206",
        category="dns", executable="dig", base_args=["@191.243.128.206", "google.com", "+short", "+time=3", "+tries=1"],
    ),

    # NFTables — via ruleset, not service
    "nft-list-tables": CommandDefinition(
        id="nft-list-tables", name="Tabelas nftables", description="Lista tabelas nftables ativas",
        category="nftables", executable="nft", base_args=["list", "tables"],
        requires_privilege=True,
        expected_failure_unprivileged="Operation not permitted (must be root)",
        remediation_hint="Executar diagnóstico via sudo restrito para nft",
    ),
    "nft-list-ruleset": CommandDefinition(
        id="nft-list-ruleset", name="Ruleset completo", description="Mostra ruleset nftables carregado no kernel",
        category="nftables", executable="nft", base_args=["list", "ruleset"],
        requires_privilege=True,
        expected_failure_unprivileged="Operation not permitted (must be root)",
        remediation_hint="Executar diagnóstico via sudo restrito para nft",
    ),
    "nft-list-counters": CommandDefinition(
        id="nft-list-counters", name="Contadores nftables", description="Mostra contadores de tráfego DNAT/balanceamento",
        category="nftables", executable="nft", base_args=["list", "counters"],
        requires_privilege=True,
        expected_failure_unprivileged="Operation not permitted (must be root)",
        remediation_hint="Executar diagnóstico via sudo restrito para nft",
    ),

    # FRR / OSPF — optional
    "frr-ospf-neighbor": CommandDefinition(
        id="frr-ospf-neighbor", name="OSPF Neighbors", description="Mostra vizinhos OSPF (opcional conforme topologia)",
        category="ospf", executable="vtysh", base_args=["-c", "show ip ospf neighbor"],
        requires_privilege=True,
        expected_failure_unprivileged="Permission denied on /etc/frr/vtysh.conf",
        remediation_hint="Ajustar grupo frrvty ou usar wrapper privilegiado",
    ),
    "frr-ospf-route": CommandDefinition(
        id="frr-ospf-route", name="OSPF Routes", description="Mostra rotas OSPF",
        category="ospf", executable="vtysh", base_args=["-c", "show ip ospf route"],
        requires_privilege=True,
        expected_failure_unprivileged="Permission denied on /etc/frr/vtysh.conf",
        remediation_hint="Ajustar grupo frrvty ou usar wrapper privilegiado",
    ),
    "frr-running-config": CommandDefinition(
        id="frr-running-config", name="FRR Running Config", description="Configuração ativa do FRR",
        category="ospf", executable="vtysh", base_args=["-c", "show running-config"],
        requires_privilege=True,
        expected_failure_unprivileged="Permission denied on /etc/frr/vtysh.conf",
        remediation_hint="Ajustar grupo frrvty ou usar wrapper privilegiado",
    ),
    "frr-ospf-summary": CommandDefinition(
        id="frr-ospf-summary", name="OSPF Summary", description="Resumo OSPF",
        category="ospf", executable="vtysh", base_args=["-c", "show ip ospf"],
        requires_privilege=True,
        expected_failure_unprivileged="Permission denied on /etc/frr/vtysh.conf",
        remediation_hint="Ajustar grupo frrvty ou usar wrapper privilegiado",
    ),

    # System
    "sys-uptime": CommandDefinition(
        id="sys-uptime", name="Uptime", description="Tempo de atividade do sistema",
        category="system", executable="uptime", base_args=["-p"],
    ),
    "sys-memory": CommandDefinition(
        id="sys-memory", name="Memória", description="Uso de memória",
        category="system", executable="free", base_args=["-m"],
    ),
    "sys-disk": CommandDefinition(
        id="sys-disk", name="Disco", description="Uso de disco",
        category="system", executable="df", base_args=["-h"],
    ),

    # Journalctl
    "journalctl": CommandDefinition(
        id="journalctl", name="Journalctl", description="Logs do systemd",
        category="logs", executable="journalctl",
        base_args=["--no-pager", "-n", "100"],
        allowed_params=["lines", "unit"],
        timeout=15,
        requires_privilege=True,
        expected_failure_unprivileged="Insufficient permissions for journal access",
        remediation_hint="Adicionar usuário ao grupo systemd-journal ou usar wrapper controlado",
    ),
}
