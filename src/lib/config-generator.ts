// ============================================================
// DNS Control — Configuration Template Generator
// Multi-Instance Recursive DNS Architecture
// Generates real Linux config files from WizardConfig
// ============================================================

import type { WizardConfig } from './types';

// ═══ UNBOUND INSTANCE CONFIG ═══

export function generateUnboundConf(config: WizardConfig, instanceIndex: number): string {
  const inst = config.instances[instanceIndex];
  if (!inst) return '# Error: Instance not found';

  const aclLines = config.accessControlIpv4
    .map(acl => `    access-control: ${acl.network} ${acl.action}`)
    .join('\n');

  const aclIpv6Lines = config.enableIpv6
    ? config.accessControlIpv6
        .map(acl => `    access-control: ${acl.network} ${acl.action}`)
        .join('\n')
    : '';

  return `
server:
    verbosity: ${config.enableDetailedLogs ? 2 : 1}
    statistics-interval: 20
    extended-statistics: yes
    num-threads: ${config.threads}

    interface: ${inst.bindIp}
${config.enableIpv6 && inst.bindIpv6 ? `    interface: ${inst.bindIpv6}` : ''}

    outgoing-interface: ${inst.egressIpv4}
${config.enableIpv6 && inst.egressIpv6 ? `    outgoing-interface: ${inst.egressIpv6}` : ''}

    outgoing-range: 512
    num-queries-per-thread: 3200

    msg-cache-size: ${config.msgCacheSize}
    rrset-cache-size: ${config.rrsetCacheSize}

    msg-cache-slabs: ${config.threads}
    rrset-cache-slabs: ${config.threads}

    cache-max-ttl: ${config.maxTtl}
    infra-host-ttl: 60
    infra-lame-ttl: 120

    infra-cache-numhosts: 10000
    infra-cache-lame-size: 10k

    do-ip4: yes
    do-ip6: ${config.enableIpv6 ? 'yes' : 'no'}
    do-udp: yes
    do-tcp: yes
    do-daemonize: yes

${aclLines}
${aclIpv6Lines}

    username: "unbound"
    directory: "/etc/unbound"
    logfile: ""
    use-syslog: no
    pidfile: "/var/run/unbound.pid"
    root-hints: "${config.rootHintsPath}"

    identity: "${config.dnsIdentity}"
    version: "${config.dnsVersion}"
    hide-identity: yes
    hide-version: yes
    harden-glue: yes
    do-not-query-address: 127.0.0.1/8
    do-not-query-localhost: yes
    module-config: "iterator"

    #zone localhost
    local-zone: "localhost." static
    local-data: "localhost. 10800 IN NS localhost."
    local-data: "localhost. 10800 IN SOA localhost. nobody.invalid. 1 3600 1200 604800 10800"
    local-data: "localhost. 10800 IN A 127.0.0.1"

    local-zone: "127.in-addr.arpa." static
    local-data: "127.in-addr.arpa. 10800 IN NS localhost."
    local-data: "127.in-addr.arpa. 10800 IN SOA localhost. nobody.invalid. 2 3600 1200 604800 10800"
    local-data: "1.0.0.127.in-addr.arpa. 10800 IN PTR localhost."

${config.enableBlocklist ? 'include: "/etc/unbound/unbound-block-domains.conf"' : '#forward-zone:\n#    name: "."\n#    forward-addr: 8.8.8.8\n#    forward-addr: 8.8.4.4'}

remote-control:
    control-enable: yes
    control-interface: ${inst.controlInterface}
    control-port: ${inst.controlPort}
    control-use-cert: "no"
`;
}

// ═══ BLOCKLIST ═══

export function generateBlocklistConf(): string {
  return `# DNS Control — Domain Blocklist
# Add domains to block here, one per line:
# local-zone: "example-ads.com" always_refuse
# local-zone: "tracking.example.com" always_refuse
`;
}

// ═══ SYSTEMD UNIT ═══

export function generateSystemdUnit(_config: WizardConfig, instanceIndex: number): string {
  const inst = _config.instances[instanceIndex];
  if (!inst) return '# Error: Instance not found';

  return `[Unit]
Description=Unbound DNS server
Documentation=man:unbound(8)
After=network.target
Before=nss-lookup.target
Wants=nss-lookup.target

[Service]
Type=notify
Restart=always
EnvironmentFile=-/etc/default/unbound
ExecStartPre=-/usr/lib/unbound/package-helper chroot_setup
ExecStartPre=-/usr/lib/unbound/package-helper root_trust_anchor_update
ExecStart=/usr/sbin/unbound -c /etc/unbound/${inst.name}.conf -d -p $DAEMON_OPTS
ExecStopPost=-/usr/lib/unbound/package-helper chroot_teardown
ExecReload=+/bin/kill -HUP $MAINPID

[Install]
WantedBy=multi-user.target
`;
}

// ═══ NETWORK POST-UP SCRIPT ═══

export function generatePostUpScript(config: WizardConfig): string {
  const lines: string[] = [
    '#!/bin/sh',
    '# DNS Control — Network post-up script',
    '# Generated configuration — do not edit manually',
    '',
  ];

  // Egress IPs (public) on loopback
  config.instances.forEach(inst => {
    lines.push(`     /usr/sbin/ip -4 addr add ${inst.egressIpv4}/32 dev lo`);
  });

  // Default route
  lines.push(`     /usr/sbin/ip -4 route add default via ${config.ipv4Gateway}`);
  lines.push('');

  // IPv6
  if (config.enableIpv6 && config.ipv6Address) {
    lines.push(`     /usr/sbin/ip -6 addr add ${config.ipv6Address} dev ${config.mainInterface}`);
    if (config.ipv6Gateway) {
      lines.push(`     /usr/sbin/ip -6 route add default via ${config.ipv6Gateway}`);
    }
    lines.push('');

    // IPv6 egress IPs
    config.instances.forEach(inst => {
      if (inst.egressIpv6) {
        lines.push(`     /usr/sbin/ip addr add ${inst.egressIpv6}/128 dev lo`);
      }
    });
    lines.push('');
  }

  // Listener IPs on loopback
  config.instances.forEach(inst => {
    lines.push(`     /usr/sbin/ip addr add ${inst.bindIp}/32 dev lo`);
  });
  lines.push('');

  // IPv6 listener IPs
  if (config.enableIpv6) {
    config.instances.forEach(inst => {
      if (inst.bindIpv6) {
        lines.push(`     /usr/sbin/ip addr add ${inst.bindIpv6}/128 dev lo`);
      }
    });
    lines.push('');
  }

  // VIP anycast IPs on loopback (commented by default — uncomment when ready)
  lines.push('     # Anycast publico, descomentar ao final da implantação');
  config.serviceVips.forEach(vip => {
    lines.push(`     #/usr/sbin/ip addr add ${vip.ipv4}/32 dev lo`);
    if (config.enableIpv6 && vip.ipv6) {
      lines.push(`     #/usr/sbin/ip addr add ${vip.ipv6}/128 dev lo`);
    }
  });
  lines.push('');
  lines.push('exit 0');

  return lines.join('\n');
}

// ═══ NETWORK INTERFACES ═══

export function generateNetworkInterfacesConf(config: WizardConfig): string {
  return `
source /etc/network/interfaces.d/*

auto lo
iface lo inet loopback

allow-hotplug ${config.mainInterface}
iface ${config.mainInterface} inet static
    address ${config.ipv4Address}
    dns-nameservers ${config.bootstrapDns}

post-up /etc/network/post-up.sh
`;
}

// ═══ NFTABLES — STICKY SOURCE + NTH BALANCING ═══

export function generateNftablesConf(config: WizardConfig): string {
  const lines: string[] = [
    '#!/usr/sbin/nft -f',
    '# DNS Control — nftables configuration',
    '# Generated configuration — do not edit manually',
    '',
    'flush ruleset',
    'include "/etc/nftables.d/*.nft"',
    '',
  ];
  return lines.join('\n');
}

export function generateNftablesModular(config: WizardConfig): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];

  // Main config
  files.push({
    path: '/etc/nftables.conf',
    content: generateNftablesConf(config),
  });

  // Tables
  files.push({
    path: '/etc/nftables.d/0002-table-ipv4-nat.nft',
    content: 'create table ip nat',
  });
  if (config.enableIpv6) {
    files.push({
      path: '/etc/nftables.d/0003-table-ipv6-nat.nft',
      content: 'create table ip6 nat',
    });
  }

  // PREROUTING chains
  files.push({
    path: '/etc/nftables.d/0051-hook-ipv4-prerouting.nft',
    content: `    create chain ip nat PREROUTING {
        type nat hook prerouting priority dstnat;
        policy accept;
    }`,
  });
  if (config.enableIpv6) {
    files.push({
      path: '/etc/nftables.d/0052-hook-ipv6-prerouting.nft',
      content: `    create chain ip6 nat PREROUTING {
        type nat hook prerouting priority dstnat;
        policy accept;
    }`,
    });
  }

  // VIP definitions
  const vipIpv4s = config.serviceVips.map(v => v.ipv4).join(',\n    ');
  files.push({
    path: '/etc/nftables.d/5100-nat-define-anyaddr-ipv4.nft',
    content: `define DNS_ANYCAST_IPV4 = {\n    ${vipIpv4s}\n}`,
  });

  if (config.enableIpv6) {
    const vipIpv6s = config.serviceVips.filter(v => v.ipv6).map(v => v.ipv6).join(',\n    ');
    if (vipIpv6s) {
      files.push({
        path: '/etc/nftables.d/5200-nat-define-anyaddr-ipv6.nft',
        content: `define DNS_ANYCAST_IPV6 = {\n    ${vipIpv6s}\n}`,
      });
    }
  }

  // DNS chains
  for (const proto of ['tcp', 'udp']) {
    files.push({
      path: `/etc/nftables.d/510${proto === 'tcp' ? '2' : '3'}-nat-chain-ipv4_${proto}_dns.nft`,
      content: `add chain ip nat ipv4_${proto}_dns`,
    });
  }

  // PREROUTING capture rules
  for (const proto of ['tcp', 'udp']) {
    files.push({
      path: `/etc/nftables.d/511${proto === 'tcp' ? '1' : '2'}-nat-rule-ipv4_${proto}_dns.nft`,
      content: `add rule ip nat PREROUTING ip daddr $DNS_ANYCAST_IPV4 ${proto} dport 53 counter packets 0 bytes 0 jump ipv4_${proto}_dns`,
    });
  }

  // Per-instance memory sets and chains (sticky source)
  let ruleid = 6001;
  config.instances.forEach(inst => {
    for (const proto of ['tcp', 'udp']) {
      const subchain = `ipv4_dns_${proto}_${inst.name}`;
      const subusers = `ipv4_users_${inst.name}`;

      files.push({
        path: `/etc/nftables.d/${ruleid}-nat-addrlist-${subusers}.nft`,
        content: `add set ip nat ${subusers} { type ipv4_addr; counter; size 8192; flags dynamic, timeout; timeout ${Math.floor(config.stickyTimeout / 60)}m; }`,
      });
      files.push({
        path: `/etc/nftables.d/${ruleid}-nat-chain-${subchain}.nft`,
        content: `add chain ip nat ${subchain}`,
      });
      ruleid++;
    }
  });

  // Action rules (add to set, DNAT)
  ruleid = 6201;
  config.instances.forEach(inst => {
    for (const proto of ['tcp', 'udp']) {
      const subchain = `ipv4_dns_${proto}_${inst.name}`;
      const subusers = `ipv4_users_${inst.name}`;

      files.push({
        path: `/etc/nftables.d/${ruleid}-nat-rule-action-${subchain}.nft`,
        content: [
          `add rule ip nat ${subchain} add @${subusers} { ip saddr } counter`,
          `add rule ip nat ${subchain} set update ip saddr timeout 0s @${subusers} counter`,
          `add rule ip nat ${subchain} ${proto} dport 53 counter dnat to ${inst.bindIp}:53`,
        ].join('\n'),
      });
      ruleid++;
    }
  });

  // Memorized source rules (check if client is already assigned)
  ruleid = 7001;
  config.instances.forEach(inst => {
    for (const proto of ['tcp', 'udp']) {
      const topchain = `ipv4_${proto}_dns`;
      const subchain = `ipv4_dns_${proto}_${inst.name}`;
      const subusers = `ipv4_users_${inst.name}`;

      files.push({
        path: `/etc/nftables.d/${ruleid}-nat-rule-memorized-${subchain}.nft`,
        content: `add rule ip nat ${topchain} ip saddr @${subusers} counter jump ${subchain}`,
      });
      ruleid++;
    }
  });

  // Nth balancing fallback
  ruleid = 7201;
  for (const proto of ['tcp', 'udp']) {
    let randNum = config.instances.length;
    config.instances.forEach(inst => {
      const topchain = `ipv4_${proto}_dns`;
      const subchain = `ipv4_dns_${proto}_${inst.name}`;

      files.push({
        path: `/etc/nftables.d/${ruleid}-nat-rule-memorized-${subchain}.nft`,
        content: `add rule ip nat ${topchain} numgen inc mod ${randNum} 0 counter jump ${subchain}`,
      });
      ruleid++;
      randNum--;
    });
  }

  // Repeat for IPv6 if enabled
  if (config.enableIpv6) {
    for (const proto of ['tcp', 'udp']) {
      files.push({
        path: `/etc/nftables.d/520${proto === 'tcp' ? '2' : '3'}-nat-chain-ipv6_${proto}_dns.nft`,
        content: `add chain ip6 nat ipv6_${proto}_dns`,
      });
      files.push({
        path: `/etc/nftables.d/521${proto === 'tcp' ? '1' : '2'}-nat-rule-ipv6_${proto}_dns.nft`,
        content: `add rule ip6 nat PREROUTING ip6 daddr $DNS_ANYCAST_IPV6 ${proto} dport 53 counter packets 0 bytes 0 jump ipv6_${proto}_dns`,
      });
    }

    ruleid = 6101;
    config.instances.forEach(inst => {
      if (!inst.bindIpv6) return;
      for (const proto of ['tcp', 'udp']) {
        const subchain = `ipv6_dns_${proto}_${inst.name}`;
        const subusers = `ipv6_users_${inst.name}`;

        files.push({
          path: `/etc/nftables.d/${ruleid}-nat-addrlist-${subusers}.nft`,
          content: `add set ip6 nat ${subusers} { type ipv6_addr; counter; size 8192; flags dynamic, timeout; timeout ${Math.floor(config.stickyTimeout / 60)}m; }`,
        });
        files.push({
          path: `/etc/nftables.d/${ruleid}-nat-chain-${subchain}.nft`,
          content: `add chain ip6 nat ${subchain}`,
        });
        ruleid++;
      }
    });

    ruleid = 6301;
    config.instances.forEach(inst => {
      if (!inst.bindIpv6) return;
      for (const proto of ['tcp', 'udp']) {
        const subchain = `ipv6_dns_${proto}_${inst.name}`;
        const subusers = `ipv6_users_${inst.name}`;

        files.push({
          path: `/etc/nftables.d/${ruleid}-nat-rule-action-${subchain}.nft`,
          content: [
            `add rule ip6 nat ${subchain} add @${subusers} { ip6 saddr } counter`,
            `add rule ip6 nat ${subchain} set update ip6 saddr timeout 0s @${subusers} counter`,
            `add rule ip6 nat ${subchain} ${proto} dport 53 counter dnat to ${inst.bindIpv6}:53`,
          ].join('\n'),
        });
        ruleid++;
      }
    });

    ruleid = 7101;
    config.instances.forEach(inst => {
      if (!inst.bindIpv6) return;
      for (const proto of ['tcp', 'udp']) {
        const topchain = `ipv6_${proto}_dns`;
        const subchain = `ipv6_dns_${proto}_${inst.name}`;
        const subusers = `ipv6_users_${inst.name}`;

        files.push({
          path: `/etc/nftables.d/${ruleid}-nat-rule-memorized-${subchain}.nft`,
          content: `add rule ip6 nat ${topchain} ip6 saddr @${subusers} counter jump ${subchain}`,
        });
        ruleid++;
      }
    });

    ruleid = 7301;
    const ipv6Instances = config.instances.filter(i => i.bindIpv6);
    for (const proto of ['tcp', 'udp']) {
      let randNum = ipv6Instances.length;
      ipv6Instances.forEach(inst => {
        const topchain = `ipv6_${proto}_dns`;
        const subchain = `ipv6_dns_${proto}_${inst.name}`;

        files.push({
          path: `/etc/nftables.d/${ruleid}-nat-rule-memorized-${subchain}.nft`,
          content: `add rule ip6 nat ${topchain} numgen inc mod ${randNum} 0 counter jump ${subchain}`,
        });
        ruleid++;
        randNum--;
      });
    }
  }

  return files;
}

// ═══ SYSCTL ═══

export function generateSysctlFiles(): { path: string; content: string }[] {
  return [
    { path: '/etc/sysctl.d/051-net-core.conf', content: `net.core.rmem_default=31457280\nnet.core.wmem_default=31457280\nnet.core.rmem_max=134217728\nnet.core.wmem_max=134217728\nnet.core.netdev_max_backlog=250000\nnet.core.optmem_max=33554432\nnet.core.default_qdisc=fq\nnet.core.somaxconn=4096` },
    { path: '/etc/sysctl.d/052-net-tcp-ipv4.conf', content: `net.ipv4.tcp_sack = 1\nnet.ipv4.tcp_timestamps = 1\nnet.ipv4.tcp_low_latency = 1\nnet.ipv4.tcp_max_syn_backlog = 8192\nnet.ipv4.tcp_rmem = 4096 87380 67108864\nnet.ipv4.tcp_wmem = 4096 65536 67108864\nnet.ipv4.tcp_congestion_control=htcp\nnet.ipv4.tcp_mtu_probing=1` },
    { path: '/etc/sysctl.d/065-default-foward-ipv4.conf', content: `net.ipv4.conf.default.forwarding=1` },
    { path: '/etc/sysctl.d/066-default-foward-ipv6.conf', content: `net.ipv6.conf.default.forwarding=1` },
    { path: '/etc/sysctl.d/067-all-foward-ipv4.conf', content: `net.ipv4.conf.all.forwarding=1` },
    { path: '/etc/sysctl.d/068-all-foward-ipv6.conf', content: `net.ipv6.conf.all.forwarding=1` },
    { path: '/etc/sysctl.d/069-ipv4-forward.conf', content: `net.ipv4.ip_forward=1` },
    { path: '/etc/sysctl.d/073-swappiness.conf', content: `vm.swappiness=1` },
    { path: '/etc/sysctl.d/090-netfilter-max.conf', content: `net.nf_conntrack_max=8000000` },
  ];
}

// ═══ FRR / OSPF ═══

export function generateFrrConf(config: WizardConfig): string {
  if (config.routingMode !== 'frr-ospf') return '# FRR disabled in configuration\n';

  const interfaceBlocks = config.ospfInterfaces.map(iface => `!
interface ${iface}
 ip ospf area ${config.ospfArea}
 ip ospf network ${config.networkType}
${iface === config.mainInterface ? ` ip ospf cost ${config.ospfCost}` : ''}`).join('\n');

  return `! DNS Control — FRR configuration
! Generated configuration — do not edit manually
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
 passive-interface lo
${interfaceBlocks}
!
line vty
!
`;
}

// ═══ DNS CONTROL SERVICE ═══

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

ProtectHome=yes
PrivateTmp=yes
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
`;
}

// ═══ GENERATE ALL FILES ═══

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

  // nftables (modular)
  files.push(...generateNftablesModular(config));

  // Sysctl
  files.push(...generateSysctlFiles());

  // FRR
  if (config.routingMode === 'frr-ospf') {
    files.push({ path: '/etc/frr/frr.conf', content: generateFrrConf(config) });
  }

  // systemd units
  config.instances.forEach((_, i) => {
    files.push({
      path: `/usr/lib/systemd/system/${config.instances[i].name}.service`,
      content: generateSystemdUnit(config, i),
    });
  });

  // DNS Control service
  files.push({ path: '/etc/systemd/system/dns-control.service', content: generateDnsControlService(config) });

  return files;
}
