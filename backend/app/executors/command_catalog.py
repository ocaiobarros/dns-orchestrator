"""
DNS Control — Command Catalog
Defines all whitelisted diagnostic commands with their arguments.
Frontend selects by command ID; arguments are constructed server-side.

Multi-instance aware: unbound commands target each instance separately
via -s <control_ip>@<control_port> and -c <config_path>.
"""

from dataclasses import dataclass, field
import glob
import json
import os


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

_DEPLOY_STATE_PATH = "/var/lib/dns-control/deploy-state.json"


def _read_deploy_state() -> dict:
    try:
        with open(_DEPLOY_STATE_PATH, "r", encoding="utf-8") as fp:
            return json.load(fp)
    except (OSError, IOError, json.JSONDecodeError):
        return {}


def _read_current_operation_mode() -> str:
    return str(_read_deploy_state().get("operationMode") or "").strip().lower()


def _parse_instance_config(config_path: str) -> dict:
    parsed = {
        "bind_ips": [],
        "control_interface": "127.0.0.1",
        "control_port": 8953,
    }
    try:
        with open(config_path, "r", encoding="utf-8") as fp:
            for line in fp:
                stripped = line.strip()
                if stripped.startswith("interface:") and not stripped.startswith("interface-automatic"):
                    bind_ip = stripped.split(":", 1)[1].strip()
                    if bind_ip and not bind_ip.startswith("#"):
                        parsed["bind_ips"].append(bind_ip)
                elif stripped.startswith("control-interface:"):
                    parsed["control_interface"] = stripped.split(":", 1)[1].strip()
                elif stripped.startswith("control-port:"):
                    try:
                        parsed["control_port"] = int(stripped.split(":", 1)[1].strip())
                    except ValueError:
                        pass
    except (OSError, IOError):
        pass
    return parsed


def _discover_runtime_instances() -> list[dict]:
    instances = []
    for config_path in sorted(glob.glob("/etc/unbound/unbound*.conf")):
        name = os.path.splitext(os.path.basename(config_path))[0]
        if name == "unbound":
            continue
        parsed = _parse_instance_config(config_path)
        instances.append({
            "name": name,
            "bind_ips": parsed["bind_ips"],
            "control_interface": parsed["control_interface"],
            "control_port": parsed["control_port"],
        })
    return instances


def _listener_command_id(ip: str) -> str:
    return ip.replace(":", "-").replace(".", "-")


COMMAND_CATALOG: dict[str, CommandDefinition] = {
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


def get_runtime_command_catalog() -> dict[str, CommandDefinition]:
    catalog = dict(COMMAND_CATALOG)
    instances = _discover_runtime_instances()

    for inst in instances:
        name = inst["name"]
        control_ip = inst.get("control_interface", "127.0.0.1")
        control_port = inst.get("control_port", 8953)
        config_path = f"/etc/unbound/{name}.conf"

        catalog[f"svc-status-{name}"] = CommandDefinition(
            id=f"svc-status-{name}",
            name=f"Status {name}",
            description=f"Status do serviço {name}",
            category="services",
            executable="systemctl",
            base_args=["status", name],
        )
        catalog[f"dns-{name}-stats"] = CommandDefinition(
            id=f"dns-{name}-stats",
            name=f"{name} stats",
            description=f"Estatísticas do {name}",
            category="dns",
            executable="unbound-control",
            base_args=["-s", f"{control_ip}@{control_port}", "-c", config_path, "stats_noreset"],
            requires_privilege=True,
            expected_failure_unprivileged="Permission denied for unbound-control",
            remediation_hint="Ajustar permissão do socket ou usar execução via sudo controlado",
        )
        catalog[f"dns-{name}-status"] = CommandDefinition(
            id=f"dns-{name}-status",
            name=f"{name} status",
            description=f"Status detalhado do {name}",
            category="dns",
            executable="unbound-control",
            base_args=["-s", f"{control_ip}@{control_port}", "-c", config_path, "status"],
            requires_privilege=True,
            expected_failure_unprivileged="Permission denied for unbound-control",
            remediation_hint="Ajustar permissão do socket ou usar execução via sudo controlado",
        )

        for bind_ip in inst.get("bind_ips", []):
            listener_id = _listener_command_id(bind_ip)
            catalog[f"dns-dig-listener-{listener_id}"] = CommandDefinition(
                id=f"dns-dig-listener-{listener_id}",
                name=f"Dig @{bind_ip}",
                description=f"Testa resolução no listener {bind_ip}",
                category="dns",
                executable="dig",
                base_args=[f"@{bind_ip}", "google.com", "+short", "+time=3", "+tries=1"],
            )

    if _read_current_operation_mode() != "simple":
        catalog["dns-vip-probe-4225"] = CommandDefinition(
            id="dns-vip-probe-4225", name="Service VIP @4.2.2.5",
            description="Probe de resolução no VIP interceptado 4.2.2.5",
            category="dns-vip", executable="dig",
            base_args=["@4.2.2.5", "google.com", "+short", "+time=3", "+tries=1"],
        )
        catalog["dns-vip-probe-4226"] = CommandDefinition(
            id="dns-vip-probe-4226", name="Service VIP @4.2.2.6",
            description="Probe de resolução no VIP interceptado 4.2.2.6",
            category="dns-vip", executable="dig",
            base_args=["@4.2.2.6", "google.com", "+short", "+time=3", "+tries=1"],
        )
        catalog["dns-vip-bind-check"] = CommandDefinition(
            id="dns-vip-bind-check", name="VIP Bind Check (lo)",
            description="Verifica se os VIPs estão configurados na interface loopback",
            category="dns-vip", executable="ip",
            base_args=["addr", "show", "lo"],
        )
        catalog["dns-root-trace"] = CommandDefinition(
            id="dns-root-trace", name="Root Trace (dig +trace)",
            description="Resolução iterativa completa desde root servers — valida recursão real",
            category="dns-vip", executable="dig",
            base_args=["+trace", "google.com"],
            timeout=15,
        )
        catalog["dns-root-query"] = CommandDefinition(
            id="dns-root-query", name="Root NS Query",
            description="Consulta direta a a.root-servers.net — valida alcançabilidade dos root servers",
            category="dns-vip", executable="dig",
            base_args=["@a.root-servers.net", ".", "NS", "+short", "+time=5", "+tries=1"],
            timeout=10,
        )

    return catalog
