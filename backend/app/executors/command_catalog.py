"""
DNS Control — Command Catalog
Defines all whitelisted diagnostic commands with their arguments.
Frontend selects by command ID; arguments are constructed server-side.
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

    def build_args(self, params: dict[str, str]) -> list[str]:
        args = list(self.base_args)
        for key in self.allowed_params:
            if key in params:
                args.append(params[key])
        return args


COMMAND_CATALOG: dict[str, CommandDefinition] = {
    # Systemctl
    "svc-status-unbound": CommandDefinition(
        id="svc-status-unbound", name="Status Unbound", description="Status do serviço Unbound",
        category="services", executable="systemctl", base_args=["status", "unbound"],
    ),
    "svc-status-frr": CommandDefinition(
        id="svc-status-frr", name="Status FRR", description="Status do serviço FRR",
        category="services", executable="systemctl", base_args=["status", "frr"],
    ),
    "svc-status-nftables": CommandDefinition(
        id="svc-status-nftables", name="Status nftables", description="Status do serviço nftables",
        category="services", executable="systemctl", base_args=["status", "nftables"],
    ),

    # Network
    "net-interfaces": CommandDefinition(
        id="net-interfaces", name="Interfaces de rede", description="Lista todas as interfaces",
        category="network", executable="ip", base_args=["addr", "show"],
    ),
    "net-routes": CommandDefinition(
        id="net-routes", name="Tabela de rotas", description="Mostra rotas do kernel",
        category="network", executable="ip", base_args=["route", "show"],
    ),
    "net-listening": CommandDefinition(
        id="net-listening", name="Portas em escuta", description="Mostra portas TCP/UDP em escuta",
        category="network", executable="ss", base_args=["-tlnp"],
    ),
    "net-connections": CommandDefinition(
        id="net-connections", name="Conexões ativas", description="Mostra conexões ativas",
        category="network", executable="ss", base_args=["-tnp"],
    ),

    # DNS
    "dns-dig-google": CommandDefinition(
        id="dns-dig-google", name="Dig google.com", description="Testa resolução DNS para google.com",
        category="dns", executable="dig", base_args=["@127.0.0.1", "google.com", "+stats"],
    ),
    "dns-dig-reverse": CommandDefinition(
        id="dns-dig-reverse", name="Dig reverso", description="Testa resolução reversa",
        category="dns", executable="dig", base_args=["@127.0.0.1", "-x", "8.8.8.8"],
    ),
    "dns-unbound-stats": CommandDefinition(
        id="dns-unbound-stats", name="Unbound stats", description="Estatísticas do Unbound",
        category="dns", executable="unbound-control", base_args=["stats_noreset"],
    ),
    "dns-unbound-status": CommandDefinition(
        id="dns-unbound-status", name="Unbound status", description="Status detalhado do Unbound",
        category="dns", executable="unbound-control", base_args=["status"],
    ),
    "dns-cache-dump": CommandDefinition(
        id="dns-cache-dump", name="Cache dump", description="Lista entradas do cache Unbound",
        category="dns", executable="unbound-control", base_args=["dump_cache"],
    ),

    # NFTables
    "nft-list-tables": CommandDefinition(
        id="nft-list-tables", name="Tabelas nftables", description="Lista tabelas nftables",
        category="nftables", executable="nft", base_args=["list", "tables"],
    ),
    "nft-list-ruleset": CommandDefinition(
        id="nft-list-ruleset", name="Ruleset completo", description="Mostra ruleset completo",
        category="nftables", executable="nft", base_args=["list", "ruleset"],
    ),
    "nft-list-counters": CommandDefinition(
        id="nft-list-counters", name="Contadores nftables", description="Mostra contadores de tráfego",
        category="nftables", executable="nft", base_args=["list", "counters"],
    ),

    # FRR / OSPF
    "frr-ospf-neighbor": CommandDefinition(
        id="frr-ospf-neighbor", name="OSPF Neighbors", description="Mostra vizinhos OSPF",
        category="ospf", executable="vtysh", base_args=["-c", "show ip ospf neighbor"],
    ),
    "frr-ospf-route": CommandDefinition(
        id="frr-ospf-route", name="OSPF Routes", description="Mostra rotas OSPF",
        category="ospf", executable="vtysh", base_args=["-c", "show ip ospf route"],
    ),
    "frr-running-config": CommandDefinition(
        id="frr-running-config", name="FRR Running Config", description="Configuração ativa do FRR",
        category="ospf", executable="vtysh", base_args=["-c", "show running-config"],
    ),
    "frr-ospf-summary": CommandDefinition(
        id="frr-ospf-summary", name="OSPF Summary", description="Resumo OSPF",
        category="ospf", executable="vtysh", base_args=["-c", "show ip ospf"],
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
        base_args=["--no-pager", "-n"],
        allowed_params=["lines", "unit"],
        timeout=15,
    ),
}
