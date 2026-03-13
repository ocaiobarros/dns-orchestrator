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

  return `server:
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
    cache-min-ttl: ${config.minTtl}
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
    pidfile: "/var/run/${inst.name}.pid"
    root-hints: "${config.rootHintsPath}"

    identity: "${config.dnsIdentity || config.hostname}"
    version: "${config.dnsVersion}"
    hide-identity: yes
    hide-version: yes
    harden-glue: yes
    harden-dnssec-stripped: yes
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
Description=Unbound DNS server — ${inst.name}
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
    `# Generated for: ${config.hostname || 'dns-control'}`,
    `# Instances: ${config.instances.map(i => i.name).join(', ')}`,
    '',
  ];

  // Egress IPs (public) on loopback — only in host-owned mode
  const isBorderRouted = config.egressDeliveryMode === 'border-routed';
  if (config.instances.some(i => i.egressIpv4)) {
    if (isBorderRouted) {
      lines.push('# === Egress IPs (border-routed: NOT added to host interfaces) ===');
      lines.push('# In border-routed mode, egress IPs are logical identities in Unbound outgoing-interface.');
      lines.push('# Upstream routing must return traffic for these IPs to this host.');
      config.instances.forEach(inst => {
        if (inst.egressIpv4) {
          lines.push(`# outgoing-interface: ${inst.egressIpv4} (${inst.name}) — routed at border`);
        }
      });
    } else {
      lines.push('# === Egress IPs (host-owned: added to loopback) ===');
      config.instances.forEach(inst => {
        if (inst.egressIpv4) {
          lines.push(`/usr/sbin/ip -4 addr add ${inst.egressIpv4}/32 dev lo`);
        }
      });
    }
    lines.push('');
  }

  // Default route
  if (config.ipv4Gateway) {
    lines.push('# === Default route ===');
    lines.push(`/usr/sbin/ip -4 route add default via ${config.ipv4Gateway}`);
    lines.push('');
  }

  // IPv6
  if (config.enableIpv6 && config.ipv6Address) {
    lines.push('# === IPv6 configuration ===');
    lines.push(`/usr/sbin/ip -6 addr add ${config.ipv6Address} dev ${config.mainInterface}`);
    if (config.ipv6Gateway) {
      lines.push(`/usr/sbin/ip -6 route add default via ${config.ipv6Gateway}`);
    }
    lines.push('');

    // IPv6 egress IPs
    const ipv6Egress = config.instances.filter(i => i.egressIpv6);
    if (ipv6Egress.length > 0) {
      lines.push('# === IPv6 egress IPs on loopback ===');
      ipv6Egress.forEach(inst => {
        lines.push(`/usr/sbin/ip addr add ${inst.egressIpv6}/128 dev lo`);
      });
      lines.push('');
    }
  }

  // Listener IPs on loopback
  if (config.instances.some(i => i.bindIp)) {
    lines.push('# === Listener IPs (internal) on loopback ===');
    config.instances.forEach(inst => {
      if (inst.bindIp) {
        lines.push(`/usr/sbin/ip addr add ${inst.bindIp}/32 dev lo`);
      }
    });
    lines.push('');
  }

  // IPv6 listener IPs
  if (config.enableIpv6) {
    const ipv6Listeners = config.instances.filter(i => i.bindIpv6);
    if (ipv6Listeners.length > 0) {
      lines.push('# === IPv6 listener IPs on loopback ===');
      ipv6Listeners.forEach(inst => {
        lines.push(`/usr/sbin/ip addr add ${inst.bindIpv6}/128 dev lo`);
      });
      lines.push('');
    }
  }

  // VIP anycast IPs on loopback
  if (config.serviceVips.length > 0) {
    const needsLocalVip = ['pseudo-anycast-local', 'vip-local-dummy', 'anycast-frr-ospf'].includes(config.deploymentMode);
    lines.push('# === VIPs de serviço (Anycast) ===');
    if (!needsLocalVip) {
      lines.push('# VIPs ficam no equipamento de borda — descomentar apenas se necessário');
    }
    config.serviceVips.forEach(vip => {
      const prefix = needsLocalVip ? '' : '#';
      lines.push(`${prefix}/usr/sbin/ip addr add ${vip.ipv4}/32 dev lo`);
      if (config.enableIpv6 && vip.ipv6) {
        lines.push(`${prefix}/usr/sbin/ip addr add ${vip.ipv6}/128 dev lo`);
      }
    });
    lines.push('');
  }

  lines.push('exit 0');
  return lines.join('\n');
}

// ═══ NETWORK INTERFACES ═══

export function generateNetworkInterfacesConf(config: WizardConfig): string {
  const vlanSuffix = config.vlanTag ? `.${config.vlanTag}` : '';
  const iface = `${config.mainInterface}${vlanSuffix}`;
  
  return `# DNS Control — Network interfaces
# Generated for: ${config.hostname || 'dns-control'}

source /etc/network/interfaces.d/*

auto lo
iface lo inet loopback

${config.vlanTag ? `auto ${config.mainInterface}\niface ${config.mainInterface} inet manual\n\nauto ${iface}\niface ${iface} inet static` : `allow-hotplug ${iface}\niface ${iface} inet static`}
    address ${config.ipv4Address}
    gateway ${config.ipv4Gateway}
    dns-nameservers ${config.bootstrapDns}

post-up /etc/network/post-up.sh
`;
}

// ═══ NFTABLES — MODULAR GENERATION ═══

export function generateNftablesConf(config: WizardConfig): string {
  return `#!/usr/sbin/nft -f
# DNS Control — nftables master configuration
# Generated for: ${config.hostname || 'dns-control'}
# Instances: ${config.instances.length} · VIPs: ${config.serviceVips.length}
# Distribution: ${config.distributionPolicy}

flush ruleset
include "/etc/nftables.d/*.nft"
`;
}

export function generateNftablesModular(config: WizardConfig): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];

  // Main config
  files.push({ path: '/etc/nftables.conf', content: generateNftablesConf(config) });

  // Tables
  files.push({ path: '/etc/nftables.d/0002-table-ipv4-nat.nft', content: 'create table ip nat' });
  if (config.enableIpv6) {
    files.push({ path: '/etc/nftables.d/0003-table-ipv6-nat.nft', content: 'create table ip6 nat' });
  }

  // PREROUTING chains
  files.push({
    path: '/etc/nftables.d/0051-hook-ipv4-prerouting.nft',
    content: `create chain ip nat PREROUTING {\n    type nat hook prerouting priority dstnat;\n    policy accept;\n}`,
  });
  if (config.enableIpv6) {
    files.push({
      path: '/etc/nftables.d/0052-hook-ipv6-prerouting.nft',
      content: `create chain ip6 nat PREROUTING {\n    type nat hook prerouting priority dstnat;\n    policy accept;\n}`,
    });
  }

  // Rate limiting chains (if enabled)
  if (config.enableDnsProtection) {
    files.push({
      path: '/etc/nftables.d/0060-table-filter.nft',
      content: `create table ip filter`,
    });
    files.push({
      path: '/etc/nftables.d/0061-hook-input.nft',
      content: `create chain ip filter INPUT {\n    type filter hook input priority 0;\n    policy accept;\n}\nadd rule ip filter INPUT udp dport 53 limit rate over 100/second burst 50 packets drop\nadd rule ip filter INPUT tcp dport 53 limit rate over 50/second burst 25 packets drop`,
    });
  }

  // VIP definitions
  if (config.serviceVips.length > 0) {
    const vipIpv4s = config.serviceVips.map(v => v.ipv4).filter(Boolean).join(',\n    ');
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

  // Per-instance chains + sticky sets
  const stickyTimeoutMin = Math.max(1, Math.floor(config.stickyTimeout / 60));
  let ruleid = 6001;
  config.instances.forEach(inst => {
    for (const proto of ['tcp', 'udp']) {
      const subchain = `ipv4_dns_${proto}_${inst.name}`;
      const subusers = `ipv4_users_${inst.name}`;

      files.push({
        path: `/etc/nftables.d/${ruleid}-nat-addrlist-${subusers}.nft`,
        content: `add set ip nat ${subusers} { type ipv4_addr; counter; size 8192; flags dynamic, timeout; timeout ${stickyTimeoutMin}m; }`,
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

  // Memorized source rules
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
        path: `/etc/nftables.d/${ruleid}-nat-rule-nth-${subchain}.nft`,
        content: `add rule ip nat ${topchain} numgen inc mod ${randNum} 0 counter jump ${subchain}`,
      });
      ruleid++;
      randNum--;
    });
  }

  // IPv6 rules
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
        files.push({ path: `/etc/nftables.d/${ruleid}-nat-addrlist-${subusers}.nft`, content: `add set ip6 nat ${subusers} { type ipv6_addr; counter; size 8192; flags dynamic, timeout; timeout ${stickyTimeoutMin}m; }` });
        files.push({ path: `/etc/nftables.d/${ruleid}-nat-chain-${subchain}.nft`, content: `add chain ip6 nat ${subchain}` });
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
        files.push({ path: `/etc/nftables.d/${ruleid}-nat-rule-memorized-${subchain}.nft`, content: `add rule ip6 nat ${topchain} ip6 saddr @${subusers} counter jump ${subchain}` });
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
        files.push({ path: `/etc/nftables.d/${ruleid}-nat-rule-nth-${subchain}.nft`, content: `add rule ip6 nat ${topchain} numgen inc mod ${randNum} 0 counter jump ${subchain}` });
        ruleid++;
        randNum--;
      });
    }
  }

  return files;
}

// ═══ SYSCTL — COMPLETE PRODUCTION TUNING ═══

export function generateSysctlFiles(config: WizardConfig): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];

  // Net core
  files.push({ path: '/etc/sysctl.d/051-net-core.conf', content: [
    'net.core.rmem_default=31457280', 'net.core.wmem_default=31457280',
    'net.core.rmem_max=134217728', 'net.core.wmem_max=134217728',
    'net.core.netdev_max_backlog=250000', 'net.core.optmem_max=33554432',
    'net.core.default_qdisc=fq', 'net.core.somaxconn=4096',
  ].join('\n') });

  // TCP IPv4
  files.push({ path: '/etc/sysctl.d/052-net-tcp-ipv4.conf', content: [
    'net.ipv4.tcp_sack = 1', 'net.ipv4.tcp_timestamps = 1',
    'net.ipv4.tcp_low_latency = 1', 'net.ipv4.tcp_max_syn_backlog = 8192',
    'net.ipv4.tcp_rmem = 4096 87380 67108864', 'net.ipv4.tcp_wmem = 4096 65536 67108864',
    'net.ipv4.tcp_mem = 6672016 6682016 7185248',
    'net.ipv4.tcp_congestion_control=htcp', 'net.ipv4.tcp_mtu_probing=1',
    'net.ipv4.tcp_moderate_rcvbuf = 1', 'net.ipv4.tcp_no_metrics_save = 1',
  ].join('\n') });

  // Port range
  files.push({ path: '/etc/sysctl.d/056-port-range-ipv4.conf', content: 'net.ipv4.ip_local_port_range=1024 65535' });

  // Default TTL
  files.push({ path: '/etc/sysctl.d/062-default-ttl-ipv4.conf', content: 'net.ipv4.ip_default_ttl=128' });

  // IPv4 neighbor / frag
  files.push({ path: '/etc/sysctl.d/063-neigh-ipv4.conf', content: [
    'net.ipv4.neigh.default.gc_interval = 30', 'net.ipv4.neigh.default.gc_stale_time = 60',
    'net.ipv4.neigh.default.gc_thresh1 = 4096', 'net.ipv4.neigh.default.gc_thresh2 = 8192',
    'net.ipv4.neigh.default.gc_thresh3 = 12288',
    'net.ipv4.ipfrag_high_thresh=4194304', 'net.ipv4.ipfrag_low_thresh=3145728',
    'net.ipv4.ipfrag_max_dist=64', 'net.ipv4.ipfrag_time=30',
  ].join('\n') });

  // IPv6 neighbor / frag
  if (config.enableIpv6) {
    files.push({ path: '/etc/sysctl.d/064-neigh-ipv6.conf', content: [
      'net.ipv6.neigh.default.gc_interval = 30', 'net.ipv6.neigh.default.gc_stale_time = 60',
      'net.ipv6.neigh.default.gc_thresh1 = 4096', 'net.ipv6.neigh.default.gc_thresh2 = 8192',
      'net.ipv6.neigh.default.gc_thresh3 = 12288',
      'net.ipv6.ip6frag_high_thresh=4194304', 'net.ipv6.ip6frag_low_thresh=3145728',
      'net.ipv6.ip6frag_time=60',
    ].join('\n') });
  }

  // Forwarding
  files.push({ path: '/etc/sysctl.d/065-default-foward-ipv4.conf', content: 'net.ipv4.conf.default.forwarding=1' });
  if (config.enableIpv6) {
    files.push({ path: '/etc/sysctl.d/066-default-foward-ipv6.conf', content: 'net.ipv6.conf.default.forwarding=1' });
  }
  files.push({ path: '/etc/sysctl.d/067-all-foward-ipv4.conf', content: 'net.ipv4.conf.all.forwarding=1' });
  if (config.enableIpv6) {
    files.push({ path: '/etc/sysctl.d/068-all-foward-ipv6.conf', content: 'net.ipv6.conf.all.forwarding=1' });
  }
  files.push({ path: '/etc/sysctl.d/069-ipv4-forward.conf', content: 'net.ipv4.ip_forward=1' });

  // Filesystem
  files.push({ path: '/etc/sysctl.d/072-fs-options.conf', content: [
    'fs.file-max = 3263776', 'fs.aio-max-nr=3263776', 'fs.mount-max=1048576',
    'fs.mqueue.msg_max=128', 'fs.mqueue.msgsize_max=131072',
    'fs.mqueue.queues_max=4096', 'fs.pipe-max-size=8388608',
  ].join('\n') });

  // Memory
  files.push({ path: '/etc/sysctl.d/073-swappiness.conf', content: 'vm.swappiness=1' });
  files.push({ path: '/etc/sysctl.d/074-vfs-cache-pressure.conf', content: 'vm.vfs_cache_pressure=50' });
  files.push({ path: '/etc/sysctl.d/087-kernel-free-min-kb.conf', content: 'vm.min_free_kbytes = 32768' });

  // Kernel
  files.push({ path: '/etc/sysctl.d/081-kernel-panic.conf', content: 'kernel.panic=3' });
  files.push({ path: '/etc/sysctl.d/082-kernel-threads.conf', content: 'kernel.threads-max=1031306' });
  files.push({ path: '/etc/sysctl.d/083-kernel-pid.conf', content: 'kernel.pid_max=262144' });
  files.push({ path: '/etc/sysctl.d/084-kernel-msgmax.conf', content: 'kernel.msgmax=327680' });
  files.push({ path: '/etc/sysctl.d/085-kernel-msgmnb.conf', content: 'kernel.msgmnb=655360' });
  files.push({ path: '/etc/sysctl.d/086-kernel-msgmni.conf', content: 'kernel.msgmni=32768' });

  // Conntrack (nf_conntrack)
  files.push({ path: '/etc/sysctl.d/090-netfilter-max.conf', content: 'net.nf_conntrack_max=8000000' });
  files.push({ path: '/etc/sysctl.d/091-netfilter-generic.conf', content: [
    'net.netfilter.nf_conntrack_buckets=262144',
    'net.netfilter.nf_conntrack_checksum=1',
    'net.netfilter.nf_conntrack_events = 1',
    'net.netfilter.nf_conntrack_expect_max = 1024',
    'net.netfilter.nf_conntrack_timestamp = 0',
  ].join('\n') });
  files.push({ path: '/etc/sysctl.d/092-netfilter-helper.conf', content: 'net.netfilter.nf_conntrack_helper=1' });
  files.push({ path: '/etc/sysctl.d/093-netfilter-icmp.conf', content: [
    'net.netfilter.nf_conntrack_icmp_timeout=30',
    'net.netfilter.nf_conntrack_icmpv6_timeout=30',
  ].join('\n') });
  files.push({ path: '/etc/sysctl.d/094-netfilter-tcp.conf', content: [
    'net.netfilter.nf_conntrack_tcp_be_liberal=0',
    'net.netfilter.nf_conntrack_tcp_loose=1',
    'net.netfilter.nf_conntrack_tcp_max_retrans=3',
    'net.netfilter.nf_conntrack_tcp_timeout_close=10',
    'net.netfilter.nf_conntrack_tcp_timeout_close_wait=10',
    'net.netfilter.nf_conntrack_tcp_timeout_established=600',
    'net.netfilter.nf_conntrack_tcp_timeout_fin_wait=10',
    'net.netfilter.nf_conntrack_tcp_timeout_last_ack=10',
    'net.netfilter.nf_conntrack_tcp_timeout_max_retrans=60',
    'net.netfilter.nf_conntrack_tcp_timeout_syn_recv=5',
    'net.netfilter.nf_conntrack_tcp_timeout_syn_sent=5',
    'net.netfilter.nf_conntrack_tcp_timeout_time_wait=30',
    'net.netfilter.nf_conntrack_tcp_timeout_unacknowledged=300',
  ].join('\n') });
  files.push({ path: '/etc/sysctl.d/095-netfilter-udp.conf', content: [
    'net.netfilter.nf_conntrack_udp_timeout=30',
    'net.netfilter.nf_conntrack_udp_timeout_stream=180',
  ].join('\n') });
  files.push({ path: '/etc/sysctl.d/096-netfilter-sctp.conf', content: [
    'net.netfilter.nf_conntrack_sctp_timeout_closed=10',
    'net.netfilter.nf_conntrack_sctp_timeout_cookie_echoed=3',
    'net.netfilter.nf_conntrack_sctp_timeout_cookie_wait=3',
    'net.netfilter.nf_conntrack_sctp_timeout_established=432000',
    'net.netfilter.nf_conntrack_sctp_timeout_heartbeat_acked=210',
    'net.netfilter.nf_conntrack_sctp_timeout_heartbeat_sent=30',
    'net.netfilter.nf_conntrack_sctp_timeout_shutdown_ack_sent=3',
    'net.netfilter.nf_conntrack_sctp_timeout_shutdown_recd=0',
    'net.netfilter.nf_conntrack_sctp_timeout_shutdown_sent=0',
  ].join('\n') });
  files.push({ path: '/etc/sysctl.d/097-netfilter-dccp.conf', content: [
    'net.netfilter.nf_conntrack_dccp_loose=1',
    'net.netfilter.nf_conntrack_dccp_timeout_closereq=64',
    'net.netfilter.nf_conntrack_dccp_timeout_closing=64',
    'net.netfilter.nf_conntrack_dccp_timeout_open=43200',
    'net.netfilter.nf_conntrack_dccp_timeout_partopen=480',
    'net.netfilter.nf_conntrack_dccp_timeout_request=240',
    'net.netfilter.nf_conntrack_dccp_timeout_respond=480',
    'net.netfilter.nf_conntrack_dccp_timeout_timewait=240',
  ].join('\n') });

  if (config.enableIpv6) {
    files.push({ path: '/etc/sysctl.d/099-netfilter-ipv6.conf', content: [
      'net.netfilter.nf_conntrack_frag6_high_thresh=4194304',
      'net.netfilter.nf_conntrack_frag6_low_thresh=3145728',
      'net.netfilter.nf_conntrack_frag6_timeout=60',
    ].join('\n') });
  }

  return files;
}

// ═══ FRR / OSPF ═══

export function generateFrrConf(config: WizardConfig): string {
  if (config.routingMode !== 'frr-ospf') return '# FRR disabled in configuration\n';

  const interfaceBlocks = config.ospfInterfaces.map(iface => `!
interface ${iface}
 ip ospf area ${config.ospfArea}
 ip ospf network ${config.networkType}
${iface === config.mainInterface ? ` ip ospf cost ${config.ospfCost}` : ''}`).join('\n');

  // Announce VIPs via connected redistribution
  const vipNetworks = config.serviceVips.map(v => `  network ${v.ipv4}/32 area ${config.ospfArea}`).join('\n');

  return `! DNS Control — FRR configuration
! Generated for: ${config.hostname || 'dns-control'}
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
${vipNetworks}
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

// ═══ DEPLOYMENT MANIFEST ═══

export function generateDeploymentManifest(config: WizardConfig, files: { path: string }[]): string {
  const now = new Date().toISOString();
  return `# DNS Control — Deployment Manifest
# Generated: ${now}
# Hostname: ${config.hostname || '(not set)'}
# Organization: ${config.organization || '(not set)'}
# Deployment Mode: ${config.deploymentMode}
# Distribution Policy: ${config.distributionPolicy}
# Routing: ${config.routingMode}
# IPv6: ${config.enableIpv6 ? 'enabled' : 'disabled'}
#
# Architecture:
#   VIPs: ${config.serviceVips.map(v => v.ipv4).join(', ') || '(none)'}
#   Instances: ${config.instances.map(i => `${i.name}@${i.bindIp}`).join(', ') || '(none)'}
#   Egress: ${config.instances.map(i => `${i.name}→${i.egressIpv4}`).join(', ') || '(none)'}
#
# Files (${files.length}):
${files.map(f => `#   ${f.path}`).join('\n')}
#
# Services to restart:
${config.instances.map(i => `#   systemctl restart ${i.name}`).join('\n')}
#   systemctl restart nftables
${config.routingMode === 'frr-ospf' ? '#   systemctl restart frr' : ''}
#   systemctl daemon-reload
#
# Post-deploy checks:
${config.serviceVips.map(v => `#   dig @${v.ipv4} google.com +short`).join('\n')}
${config.instances.map(i => `#   unbound-control -c /etc/unbound/${i.name}.conf -s ${i.controlInterface}@${i.controlPort} status`).join('\n')}
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

  // Sysctl (complete)
  files.push(...generateSysctlFiles(config));

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

  // Deployment manifest
  files.push({ path: '/var/lib/dns-control/manifest.txt', content: generateDeploymentManifest(config, files) });

  return files;
}
