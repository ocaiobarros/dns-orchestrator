"""
DNS Control — Sysctl Configuration Generator
Generates carrier-grade kernel tuning files in /etc/sysctl.d/
matching the production reference (Part1) exactly, including all
conntrack parameters and nf_conntrack_helper.
"""

from typing import Any


def generate_sysctl_configs(payload: dict[str, Any]) -> list[dict]:
    """Generate all sysctl.d files for carrier-grade DNS node tuning."""
    files: list[dict] = []

    def _file(path: str, content: str):
        files.append({"path": path, "content": content, "permissions": "0644", "owner": "root:root"})

    # ═══ Net Core ═══
    _file("/etc/sysctl.d/051-net-core.conf", "\n".join([
        "net.core.rmem_default=31457280",
        "net.core.wmem_default=31457280",
        "net.core.rmem_max=134217728",
        "net.core.wmem_max=134217728",
        "net.core.netdev_max_backlog=250000",
        "net.core.optmem_max=33554432",
        "net.core.default_qdisc=fq",
        "net.core.somaxconn=4096",
    ]))

    # ═══ TCP IPv4 ═══
    _file("/etc/sysctl.d/052-net-tcp-ipv4.conf", "\n".join([
        "net.ipv4.tcp_sack = 1",
        "net.ipv4.tcp_timestamps = 1",
        "net.ipv4.tcp_low_latency = 1",
        "net.ipv4.tcp_max_syn_backlog = 8192",
        "net.ipv4.tcp_rmem = 4096 87380 67108864",
        "net.ipv4.tcp_wmem = 4096 65536 67108864",
        "net.ipv4.tcp_mem = 6672016 6682016 7185248",
        "net.ipv4.tcp_congestion_control=htcp",
        "net.ipv4.tcp_mtu_probing=1",
        "net.ipv4.tcp_moderate_rcvbuf =1",
        "net.ipv4.tcp_no_metrics_save = 1",
    ]))

    # ═══ Port Range ═══
    _file("/etc/sysctl.d/056-port-range-ipv4.conf",
          "net.ipv4.ip_local_port_range=1024 65535")

    # ═══ Default TTL ═══
    _file("/etc/sysctl.d/062-default-ttl-ipv4.conf",
          "net.ipv4.ip_default_ttl=128")

    # ═══ Neighbor / Frag IPv4 ═══
    _file("/etc/sysctl.d/063-neigh-ipv4.conf", "\n".join([
        "net.ipv4.neigh.default.gc_interval = 30",
        "net.ipv4.neigh.default.gc_stale_time = 60",
        "net.ipv4.neigh.default.gc_thresh1 = 4096",
        "net.ipv4.neigh.default.gc_thresh2 = 8192",
        "net.ipv4.neigh.default.gc_thresh3 = 12288",
        "net.ipv4.ipfrag_high_thresh=4194304",
        "net.ipv4.ipfrag_low_thresh=3145728",
        "net.ipv4.ipfrag_max_dist=64",
        "net.ipv4.ipfrag_secret_interval=0",
        "net.ipv4.ipfrag_time=30",
    ]))

    # ═══ Neighbor / Frag IPv6 ═══
    _file("/etc/sysctl.d/064-neigh-ipv6.conf", "\n".join([
        "net.ipv6.neigh.default.gc_interval = 30",
        "net.ipv6.neigh.default.gc_stale_time = 60",
        "net.ipv6.neigh.default.gc_thresh1 = 4096",
        "net.ipv6.neigh.default.gc_thresh2 = 8192",
        "net.ipv6.neigh.default.gc_thresh3 = 12288",
        "net.ipv6.ip6frag_high_thresh=4194304",
        "net.ipv6.ip6frag_low_thresh=3145728",
        "net.ipv6.ip6frag_secret_interval=0",
        "net.ipv6.ip6frag_time=60",
    ]))

    # ═══ Forwarding ═══
    _file("/etc/sysctl.d/065-default-foward-ipv4.conf", "net.ipv4.conf.default.forwarding=1")
    _file("/etc/sysctl.d/066-default-foward-ipv6.conf", "net.ipv6.conf.default.forwarding=1")
    _file("/etc/sysctl.d/067-all-foward-ipv4.conf", "net.ipv4.conf.all.forwarding=1")
    _file("/etc/sysctl.d/068-all-foward-ipv6.conf", "net.ipv6.conf.all.forwarding=1")
    _file("/etc/sysctl.d/069-ipv4-forward.conf", "net.ipv4.ip_forward=1")

    # ═══ Filesystem ═══
    _file("/etc/sysctl.d/072-fs-options.conf", "\n".join([
        "fs.file-max = 3263776",
        "fs.aio-max-nr=3263776",
        "fs.mount-max=1048576",
        "fs.mqueue.msg_max=128",
        "fs.mqueue.msgsize_max=131072",
        "fs.mqueue.queues_max=4096",
        "fs.pipe-max-size=8388608",
    ]))

    # ═══ VM ═══
    _file("/etc/sysctl.d/073-swappiness.conf", "vm.swappiness=1")
    _file("/etc/sysctl.d/074-vfs-cache-pressure.conf", "vm.vfs_cache_pressure=50")

    # ═══ Kernel ═══
    _file("/etc/sysctl.d/081-kernel-panic.conf", "kernel.panic=3")
    _file("/etc/sysctl.d/082-kernel-threads.conf", "kernel.threads-max=1031306")
    _file("/etc/sysctl.d/083-kernel-pid.conf", "kernel.pid_max=262144")
    _file("/etc/sysctl.d/084-kernel-msgmax.conf", "kernel.msgmax=327680")
    _file("/etc/sysctl.d/085-kernel-msgmnb.conf", "kernel.msgmnb=655360")
    _file("/etc/sysctl.d/086-kernel-msgmni.conf", "kernel.msgmni=32768")
    _file("/etc/sysctl.d/087-kernel-free-min-kb.conf", "vm.min_free_kbytes = 32768")

    # ═══ Conntrack / Netfilter ═══
    _file("/etc/sysctl.d/090-netfilter-max.conf", "net.nf_conntrack_max=8000000")

    _file("/etc/sysctl.d/091-netfilter-generic.conf", "\n".join([
        "net.netfilter.nf_conntrack_buckets=262144",
        "net.netfilter.nf_conntrack_checksum=1",
        "net.netfilter.nf_conntrack_events = 1",
        "net.netfilter.nf_conntrack_expect_max = 1024",
        "net.netfilter.nf_conntrack_timestamp = 0",
    ]))

    # nf_conntrack_helper — present in Part1 reference
    _file("/etc/sysctl.d/092-netfilter-helper.conf",
          "net.netfilter.nf_conntrack_helper=1")

    _file("/etc/sysctl.d/093-netfilter-icmp.conf", "\n".join([
        "net.netfilter.nf_conntrack_icmp_timeout=30",
        "net.netfilter.nf_conntrack_icmpv6_timeout=30",
    ]))

    _file("/etc/sysctl.d/094-netfilter-tcp.conf", "\n".join([
        "net.netfilter.nf_conntrack_tcp_be_liberal=0",
        "net.netfilter.nf_conntrack_tcp_loose=1",
        "net.netfilter.nf_conntrack_tcp_max_retrans=3",
        "net.netfilter.nf_conntrack_tcp_timeout_close=10",
        "net.netfilter.nf_conntrack_tcp_timeout_close_wait=10",
        "net.netfilter.nf_conntrack_tcp_timeout_established=600",
        "net.netfilter.nf_conntrack_tcp_timeout_fin_wait=10",
        "net.netfilter.nf_conntrack_tcp_timeout_last_ack=10",
        "net.netfilter.nf_conntrack_tcp_timeout_max_retrans=60",
        "net.netfilter.nf_conntrack_tcp_timeout_syn_recv=5",
        "net.netfilter.nf_conntrack_tcp_timeout_syn_sent=5",
        "net.netfilter.nf_conntrack_tcp_timeout_time_wait=30",
        "net.netfilter.nf_conntrack_tcp_timeout_unacknowledged=300",
    ]))

    _file("/etc/sysctl.d/095-netfilter-udp.conf", "\n".join([
        "net.netfilter.nf_conntrack_udp_timeout=30",
        "net.netfilter.nf_conntrack_udp_timeout_stream=180",
    ]))

    _file("/etc/sysctl.d/096-netfilter-sctp.conf", "\n".join([
        "net.netfilter.nf_conntrack_sctp_timeout_closed=10",
        "net.netfilter.nf_conntrack_sctp_timeout_cookie_echoed=3",
        "net.netfilter.nf_conntrack_sctp_timeout_cookie_wait=3",
        "net.netfilter.nf_conntrack_sctp_timeout_established=432000",
        "net.netfilter.nf_conntrack_sctp_timeout_heartbeat_acked=210",
        "net.netfilter.nf_conntrack_sctp_timeout_heartbeat_sent=30",
        "net.netfilter.nf_conntrack_sctp_timeout_shutdown_ack_sent=3",
        "net.netfilter.nf_conntrack_sctp_timeout_shutdown_recd=0",
        "net.netfilter.nf_conntrack_sctp_timeout_shutdown_sent=0",
    ]))

    _file("/etc/sysctl.d/097-netfilter-dccp.conf", "\n".join([
        "net.netfilter.nf_conntrack_dccp_loose=1",
        "net.netfilter.nf_conntrack_dccp_timeout_closereq=64",
        "net.netfilter.nf_conntrack_dccp_timeout_closing=64",
        "net.netfilter.nf_conntrack_dccp_timeout_open=43200",
        "net.netfilter.nf_conntrack_dccp_timeout_partopen=480",
        "net.netfilter.nf_conntrack_dccp_timeout_request=240",
        "net.netfilter.nf_conntrack_dccp_timeout_respond=480",
        "net.netfilter.nf_conntrack_dccp_timeout_timewait=240",
    ]))

    _file("/etc/sysctl.d/099-netfilter-ipv6.conf", "\n".join([
        "net.netfilter.nf_conntrack_frag6_high_thresh=4194304",
        "net.netfilter.nf_conntrack_frag6_low_thresh=3145728",
        "net.netfilter.nf_conntrack_frag6_timeout=60",
    ]))

    return files
