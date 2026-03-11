// ============================================================
// DNS Control — Configuration Template Generator
// Generates real Linux config files from WizardConfig
// ============================================================

import type { WizardConfig } from './types';

export function generateUnboundConf(config: WizardConfig, instanceIndex: number): string {
  const inst = config.instances[instanceIndex];
  if (!inst) return '# Error: Instance not found';

  return `# DNS Control — Unbound configuration
# Instance: ${inst.name}
# Generated: ${new Date().toISOString()}

server:
    interface: ${inst.bindIp}
    port: 53
    outgoing-interface: ${inst.exitIp}

    num-threads: ${config.threads}
    msg-cache-slabs: ${config.threads}
    rrset-cache-slabs: ${config.threads}
    infra-cache-slabs: ${config.threads}
    key-cache-slabs: ${config.threads}

    msg-cache-size: ${config.msgCacheSize}
    rrset-cache-size: ${config.rrsetCacheSize}
    key-cache-size: ${config.keyCacheSize}

    cache-min-ttl: ${config.minTtl}
    cache-max-ttl: ${config.maxTtl}

    do-ip4: yes
    do-ip6: ${config.enableIpv6 ? 'yes' : 'no'}
    do-udp: yes
    do-tcp: yes
    do-daemonize: no

    access-control: 0.0.0.0/0 allow
${config.enableIpv6 ? '    access-control: ::/0 allow' : ''}

    root-hints: "${config.rootHintsPath}"

    hide-identity: yes
    hide-version: yes
    harden-glue: yes
    harden-dnssec-stripped: yes
    harden-referral-path: yes
    use-caps-for-id: yes

    prefetch: yes
    prefetch-key: yes
    so-reuseport: yes

    num-queries-per-thread: 4096
    outgoing-range: 8192
    so-rcvbuf: 4m
    so-sndbuf: 4m

    unwanted-reply-threshold: 10000
    val-clean-additional: yes

${config.enableDetailedLogs ? `    verbosity: 2
    log-queries: yes
    log-replies: yes
    log-servfail: yes` : `    verbosity: 1
    log-queries: no
    log-replies: no
    log-servfail: yes`}

    logfile: ""
    use-syslog: yes
    log-time-ascii: yes

${config.enableBlocklist ? `include: "/etc/unbound/unbound-block-domains.conf"` : '# Blocklist disabled'}

remote-control:
    control-enable: yes
    control-port: ${inst.controlPort}
    control-interface: 127.0.0.1
    control-use-cert: no
`;
}

export function generateBlocklistConf(): string {
  return `# DNS Control — Domain Blocklist
# Add domains to block here, one per line:
# local-zone: "example-ads.com" always_refuse
# local-zone: "tracking.example.com" always_refuse

# To populate automatically, use a blocklist feed script
# and regenerate this file periodically.
`;
}

export function generateNftablesConf(config: WizardConfig): string {
  const backends = config.nftDnatTargets;
  const mapEntries = backends.map((ip, i) => `        ${i} : dnat to ${ip}`).join(',\n');

  let stickySection = '';
  if (config.stickySourceIp) {
    stickySection = `
    # Sticky source IP (meter-based)
    # Note: For full sticky support, consider using nftables sets
    # with timeout. This is a simplified round-robin approach.`;
  }

  const protectionRules = config.enableDnsProtection ? `
    # DNS protection — rate limiting
    udp dport 53 meter dns_rate { ip saddr limit rate 100/second } accept
    udp dport 53 meter dns_rate_drop { ip saddr limit rate over 100/second } drop
    tcp dport 53 ct state new meter dns_tcp_rate { ip saddr limit rate 20/second } accept
    tcp dport 53 ct state new meter dns_tcp_drop { ip saddr limit rate over 20/second } drop` : '';

  return `#!/usr/sbin/nft -f
# DNS Control — nftables configuration
# Generated: ${new Date().toISOString()}
# VIP: ${config.nftVipTarget} → ${backends.length} backends

flush ruleset

table ip nat {
    chain prerouting {
        type nat hook prerouting priority dstnat; policy accept;
${stickySection}
        # UDP DNS DNAT
        ip daddr ${config.nftVipTarget} udp dport 53 numgen inc mod ${backends.length} map {
${mapEntries}
        }

        # TCP DNS DNAT
        ip daddr ${config.nftVipTarget} tcp dport 53 numgen inc mod ${backends.length} map {
${mapEntries}
        }
    }

    chain postrouting {
        type nat hook postrouting priority srcnat; policy accept;
        masquerade
    }
}

table ip filter {
    chain input {
        type filter hook input priority filter; policy drop;

        # Established connections
        ct state established,related accept
        ct state invalid drop

        # Loopback
        iif lo accept

        # ICMP
        ip protocol icmp accept

        # DNS
        udp dport 53 accept
        tcp dport 53 accept

        # Management panel
        tcp dport ${config.panelPort} accept

        # OSPF
${config.enableFrr ? '        ip protocol ospf accept' : '        # OSPF disabled'}

        # SSH (optional — restrict in production)
        tcp dport 22 accept
${protectionRules}

        # Logging dropped packets
        counter log prefix "nft-drop: " drop
    }

    chain forward {
        type filter hook forward priority filter; policy drop;
        ct state established,related accept
    }

    chain output {
        type filter hook output priority filter; policy accept;
    }
}
`;
}

export function generateFrrConf(config: WizardConfig): string {
  if (!config.enableFrr) return '# FRR disabled in configuration\n';

  const interfaceBlocks = config.ospfInterfaces.map(iface => `!
interface ${iface}
 ip ospf area ${config.ospfArea}
 ip ospf network ${config.networkType}
${iface === config.mainInterface ? ` ip ospf cost ${config.ospfCost}` : ''}`).join('\n');

  return `! DNS Control — FRR configuration
! Generated: ${new Date().toISOString()}
!
frr version 10.2
frr defaults traditional
hostname ${config.hostname || 'dns-control'}
log syslog informational
service integrated-vtysh-config
!
router ospf
 ospf router-id ${config.routerId}
${config.redistributeConnected ? ' redistribute connected' : ''}
 network ${config.ipv4Address.replace(/\/\d+$/, '') ? config.ipv4Address.split('/')[0].split('.').slice(0, 3).join('.') + '.0/' + config.ipv4Address.split('/')[1] : config.ipv4Address} area ${config.ospfArea}
 passive-interface ${config.dummyInterface}
${interfaceBlocks}
!
line vty
!
`;
}

export function generatePostUpScript(config: WizardConfig): string {
  const bindIps = config.unboundBindIps.map(ip =>
    `ip addr replace ${ip} dev ${config.dummyInterface}`
  ).join('\n');

  const exitIps = config.publicExitIps.map(ip =>
    `ip addr replace ${ip} dev ${config.dummyInterface}`
  ).join('\n');

  const ipv6Section = config.enableIpv6 ? `
# IPv6 bind IPs
${config.ipv6BindIps.map(ip => `ip -6 addr replace ${ip} dev ${config.dummyInterface}`).join('\n')}

# IPv6 exit IPs
${config.ipv6ExitIps.map(ip => `ip -6 addr replace ${ip} dev ${config.dummyInterface}`).join('\n')}

# IPv6 VIP
${config.vipAnycastIpv6 ? `ip -6 addr replace ${config.vipAnycastIpv6} dev ${config.dummyInterface}` : '# No IPv6 VIP configured'}` : '# IPv6 disabled';

  return `#!/bin/bash
# DNS Control — Network post-up script
# Generated: ${new Date().toISOString()}
# This script is idempotent — safe to re-run

set -euo pipefail

echo "[dns-control] Configuring dummy interface and IPs..."

# Create dummy interface if not exists
ip link add ${config.dummyInterface} type dummy 2>/dev/null || true
ip link set ${config.dummyInterface} up

# VIP Anycast
ip addr replace ${config.vipAnycastIpv4} dev ${config.dummyInterface}

# Unbound bind IPs
${bindIps}

# Public exit IPs
${exitIps}

${ipv6Section}

# Default route (idempotent)
ip route replace default via ${config.ipv4Gateway} dev ${config.mainInterface} 2>/dev/null || true
${config.enableIpv6 && config.ipv6Gateway ? `ip -6 route replace default via ${config.ipv6Gateway} dev ${config.mainInterface} 2>/dev/null || true` : ''}

echo "[dns-control] Network configuration applied successfully."
`;
}

export function generateSystemdUnit(config: WizardConfig, instanceIndex: number): string {
  const inst = config.instances[instanceIndex];
  if (!inst) return '# Error: Instance not found';

  return `[Unit]
Description=Unbound DNS resolver (${inst.name})
Documentation=man:unbound(8)
After=network.target dns-control-network.service
Wants=dns-control-network.service

[Service]
Type=notify
NotifyAccess=main
ExecStartPre=/usr/sbin/unbound-checkconf /etc/unbound/${inst.name}.conf
ExecStart=/usr/sbin/unbound -d -c /etc/unbound/${inst.name}.conf
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=5
WatchdogSec=30

# Security hardening
ProtectSystem=strict
ReadWritePaths=/var/lib/unbound /var/log/unbound /run/unbound
PrivateTmp=yes
NoNewPrivileges=yes
ProtectHome=yes
ProtectKernelModules=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes

[Install]
WantedBy=multi-user.target
`;
}

export function generateNetworkInterfacesConf(config: WizardConfig): string {
  return `# DNS Control — Network interfaces
# Generated: ${new Date().toISOString()}
# For use with ifupdown2

auto lo
iface lo inet loopback

auto ${config.mainInterface}
iface ${config.mainInterface} inet static
    address ${config.ipv4Address}
    gateway ${config.ipv4Gateway}
    dns-nameservers ${config.bootstrapDns}
${config.enableIpv6 ? `
iface ${config.mainInterface} inet6 static
    address ${config.ipv6Address}
    gateway ${config.ipv6Gateway}` : ''}

auto ${config.dummyInterface}
iface ${config.dummyInterface} inet manual
    pre-up ip link add ${config.dummyInterface} type dummy 2>/dev/null || true
    up ip link set ${config.dummyInterface} up
    post-up /etc/network/post-up.sh
`;
}

export function generateDnsControlService(config: WizardConfig): string {
  return `[Unit]
Description=DNS Control — Management Panel
After=network.target

[Service]
Type=simple
User=dns-control
Group=dns-control
WorkingDirectory=/opt/dns-control
ExecStart=/opt/dns-control/venv/bin/uvicorn app.main:app --host ${config.panelBind} --port ${config.panelPort} --workers 2
Restart=on-failure
RestartSec=10
Environment=DNS_CONTROL_DB=/var/lib/dns-control/dns-control.db
Environment=DNS_CONTROL_LOG=/var/log/dns-control/app.log
Environment=DNS_CONTROL_CONFIG=/var/lib/dns-control/config.json

# Security
ProtectHome=yes
PrivateTmp=yes
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
`;
}

export function generateAllFiles(config: WizardConfig): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];

  // Network
  files.push({ path: '/etc/network/interfaces', content: generateNetworkInterfacesConf(config) });
  files.push({ path: '/etc/network/post-up.sh', content: generatePostUpScript(config) });

  // Unbound instances
  config.instances.forEach((_, i) => {
    files.push({
      path: `/etc/unbound/${config.instances[i].name}.conf`,
      content: generateUnboundConf(config, i),
    });
  });

  // Blocklist
  if (config.enableBlocklist) {
    files.push({ path: '/etc/unbound/unbound-block-domains.conf', content: generateBlocklistConf() });
  }

  // nftables
  files.push({ path: '/etc/nftables.conf', content: generateNftablesConf(config) });

  // FRR
  if (config.enableFrr) {
    files.push({ path: '/etc/frr/frr.conf', content: generateFrrConf(config) });
  }

  // systemd units
  config.instances.forEach((_, i) => {
    files.push({
      path: `/etc/systemd/system/${config.instances[i].name}.service`,
      content: generateSystemdUnit(config, i),
    });
  });

  // DNS Control service
  files.push({ path: '/etc/systemd/system/dns-control.service', content: generateDnsControlService(config) });

  return files;
}
