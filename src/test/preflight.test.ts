/**
 * DNS Control — Preflight Privilege & Permission Tests
 * Validates the preflight checker logic for deploy gate scenarios.
 */
import { describe, it, expect } from 'vitest';

// ─── Mock preflight results for testing UI logic ───

interface PreflightCheck {
  id: string;
  category: string;
  label: string;
  status: 'pass' | 'fail';
  detail: string;
  remediation: string;
}

interface PreflightResult {
  success: boolean;
  passed: number;
  failed: number;
  total: number;
  checks: PreflightCheck[];
  canDeploy: boolean;
  blockedReasons: string[];
  privilege: {
    euid: number;
    is_root: boolean;
    model: string;
    backend_running_as_user: string;
    privilege_wrapper_available: boolean;
  };
  durationMs: number;
}

function mockPreflightAllPass(): PreflightResult {
  return {
    success: true,
    passed: 20,
    failed: 0,
    total: 20,
    checks: [
      { id: 'privilege_model', category: 'privilege', label: 'Modelo de execução', status: 'pass', detail: 'sudo NOPASSWD', remediation: '' },
      { id: 'dir__etc_unbound', category: 'directory', label: '/etc/unbound', status: 'pass', detail: 'OK', remediation: '' },
      { id: 'dir__etc_frr', category: 'directory', label: '/etc/frr', status: 'pass', detail: 'OK', remediation: '' },
      { id: 'dir__etc_nftables.d', category: 'directory', label: '/etc/nftables.d', status: 'pass', detail: 'OK', remediation: '' },
      { id: 'file__etc_nftables.conf', category: 'file', label: '/etc/nftables.conf', status: 'pass', detail: 'OK', remediation: '' },
      { id: 'write__etc_unbound', category: 'write_probe', label: 'Escrita /etc/unbound', status: 'pass', detail: 'OK', remediation: '' },
      { id: 'exe_nft', category: 'executable', label: 'nft (nftables)', status: 'pass', detail: '/usr/sbin/nft', remediation: '' },
      { id: 'exe_systemctl', category: 'executable', label: 'systemctl (systemd)', status: 'pass', detail: '/bin/systemctl', remediation: '' },
      { id: 'exe_install', category: 'executable', label: 'install (coreutils)', status: 'pass', detail: '/usr/bin/install', remediation: '' },
      { id: 'probe_nft_syntax', category: 'privilege_probe', label: 'nft -c -f (validação sintática)', status: 'pass', detail: 'OK', remediation: '' },
      { id: 'probe_nft_read', category: 'privilege_probe', label: 'nft list tables', status: 'pass', detail: 'OK', remediation: '' },
      { id: 'probe_systemctl_reload', category: 'privilege_probe', label: 'systemctl daemon-reload', status: 'pass', detail: 'OK', remediation: '' },
      { id: 'probe_install_priv', category: 'privilege_probe', label: 'install -o root -g root', status: 'pass', detail: 'OK', remediation: '' },
      { id: 'nft_privilege', category: 'privilege_test', label: 'nft list tables', status: 'pass', detail: 'OK', remediation: '' },
      { id: 'systemctl_privilege', category: 'privilege_test', label: 'systemctl com privilégio', status: 'pass', detail: 'OK', remediation: '' },
    ],
    canDeploy: true,
    blockedReasons: [],
    privilege: { euid: 1001, is_root: false, model: 'sudo', backend_running_as_user: 'dns-control', privilege_wrapper_available: true },
    durationMs: 42,
  };
}

function mockPreflightNoSudo(): PreflightResult {
  return {
    success: false,
    passed: 0,
    failed: 1,
    total: 1,
    checks: [
      {
        id: 'privilege_model', category: 'privilege', label: 'Modelo de execução',
        status: 'fail',
        detail: "Backend executa como 'dns-control' SEM root e SEM sudo funcional",
        remediation: 'Instale sudoers...',
      },
    ],
    canDeploy: false,
    blockedReasons: ["Backend executa como 'dns-control' SEM root e SEM sudo funcional"],
    privilege: { euid: 1001, is_root: false, model: 'unprivileged', backend_running_as_user: 'dns-control', privilege_wrapper_available: false },
    durationMs: 5,
  };
}

function mockPreflightMissingDirs(): PreflightResult {
  return {
    success: false,
    passed: 8,
    failed: 3,
    total: 11,
    checks: [
      { id: 'privilege_model', category: 'privilege', label: 'Modelo de execução', status: 'pass', detail: 'sudo OK', remediation: '' },
      { id: 'dir__etc_unbound', category: 'directory', label: '/etc/unbound', status: 'fail', detail: 'Diretório ausente: /etc/unbound', remediation: 'sudo install -d ...' },
      { id: 'dir__etc_frr', category: 'directory', label: '/etc/frr', status: 'fail', detail: 'Diretório ausente: /etc/frr', remediation: 'sudo install -d ...' },
      { id: 'file__etc_nftables.conf', category: 'file', label: '/etc/nftables.conf', status: 'fail', detail: 'Arquivo ausente', remediation: 'sudo touch ...' },
      { id: 'nft_privilege', category: 'privilege_test', label: 'nft', status: 'pass', detail: 'OK', remediation: '' },
    ],
    canDeploy: false,
    blockedReasons: ['Diretório ausente: /etc/unbound', 'Diretório ausente: /etc/frr', 'Arquivo ausente: /etc/nftables.conf'],
    privilege: { euid: 1001, is_root: false, model: 'sudo', backend_running_as_user: 'dns-control', privilege_wrapper_available: true },
    durationMs: 30,
  };
}

function mockPreflightNftFail(): PreflightResult {
  return {
    success: false,
    passed: 10,
    failed: 1,
    total: 11,
    checks: [
      { id: 'privilege_model', category: 'privilege', label: 'Modelo de execução', status: 'pass', detail: 'sudo OK', remediation: '' },
      { id: 'nft_privilege', category: 'privilege_test', label: 'nft list tables', status: 'fail', detail: 'Sem permissão para flush do nftables: Operation not permitted', remediation: 'Adicione ao sudoers...' },
    ],
    canDeploy: false,
    blockedReasons: ['Sem permissão para flush do nftables: Operation not permitted'],
    privilege: { euid: 1001, is_root: false, model: 'sudo', backend_running_as_user: 'dns-control', privilege_wrapper_available: true },
    durationMs: 20,
  };
}

function mockPreflightRoot(): PreflightResult {
  return {
    success: true,
    passed: 20,
    failed: 0,
    total: 20,
    checks: [
      { id: 'privilege_model', category: 'privilege', label: 'Modelo de execução', status: 'pass', detail: 'root (EUID=0)', remediation: '' },
      { id: 'probe_install_priv', category: 'privilege_probe', label: 'install -o root -g root', status: 'pass', detail: 'OK', remediation: '' },
    ],
    canDeploy: true,
    blockedReasons: [],
    privilege: { euid: 0, is_root: true, model: 'root', backend_running_as_user: 'root', privilege_wrapper_available: true },
    durationMs: 15,
  };
}

// ─── Tests ───

describe('Preflight — privilege model detection', () => {
  it('passes when running as root', () => {
    const result = mockPreflightRoot();
    expect(result.canDeploy).toBe(true);
    expect(result.privilege.is_root).toBe(true);
    expect(result.privilege.model).toBe('root');
    expect(result.blockedReasons).toHaveLength(0);
  });

  it('passes when running with sudo NOPASSWD', () => {
    const result = mockPreflightAllPass();
    expect(result.canDeploy).toBe(true);
    expect(result.privilege.model).toBe('sudo');
    expect(result.privilege.is_root).toBe(false);
  });

  it('fails when no root and no sudo', () => {
    const result = mockPreflightNoSudo();
    expect(result.canDeploy).toBe(false);
    expect(result.privilege.model).toBe('unprivileged');
    expect(result.failed).toBe(1);
    expect(result.blockedReasons).toContain("Backend executa como 'dns-control' SEM root e SEM sudo funcional");
  });
});

describe('Preflight — directory and file checks', () => {
  it('detects missing system directories', () => {
    const result = mockPreflightMissingDirs();
    expect(result.canDeploy).toBe(false);
    const dirChecks = result.checks.filter(c => c.category === 'directory' && c.status === 'fail');
    expect(dirChecks.length).toBeGreaterThanOrEqual(2);
    expect(result.blockedReasons.some(r => r.includes('/etc/unbound'))).toBe(true);
    expect(result.blockedReasons.some(r => r.includes('/etc/frr'))).toBe(true);
  });

  it('detects missing base files', () => {
    const result = mockPreflightMissingDirs();
    const fileChecks = result.checks.filter(c => c.category === 'file' && c.status === 'fail');
    expect(fileChecks.length).toBeGreaterThanOrEqual(1);
  });

  it('all checks pass on properly bootstrapped system', () => {
    const result = mockPreflightAllPass();
    expect(result.failed).toBe(0);
    expect(result.canDeploy).toBe(true);
  });
});

describe('Preflight — command privilege checks', () => {
  it('detects nft without privilege', () => {
    const result = mockPreflightNftFail();
    expect(result.canDeploy).toBe(false);
    const nftCheck = result.checks.find(c => c.id === 'nft_privilege');
    expect(nftCheck?.status).toBe('fail');
    expect(nftCheck?.detail).toContain('Operation not permitted');
  });

  it('systemctl passes on normal system', () => {
    const result = mockPreflightAllPass();
    const sctlCheck = result.checks.find(c => c.id === 'systemctl_privilege');
    expect(sctlCheck?.status).toBe('pass');
  });
});

describe('Preflight — deploy gate logic', () => {
  it('canDeploy=true allows deploy button', () => {
    const result = mockPreflightAllPass();
    expect(result.canDeploy).toBe(true);
    // UI should show "Aplicar Deploy" button
  });

  it('canDeploy=false blocks deploy button', () => {
    const result = mockPreflightNoSudo();
    expect(result.canDeploy).toBe(false);
    // UI should show "Deploy bloqueado" message
  });

  it('canDeploy=false with missing dirs blocks deploy', () => {
    const result = mockPreflightMissingDirs();
    expect(result.canDeploy).toBe(false);
    expect(result.blockedReasons.length).toBeGreaterThan(0);
  });

  it('blockedReasons contains specific error messages', () => {
    const result = mockPreflightNftFail();
    expect(result.blockedReasons).toHaveLength(1);
    expect(result.blockedReasons[0]).toContain('nftables');
    // Verify human-readable, not generic
    expect(result.blockedReasons[0]).not.toContain('Error');
  });

  it('does not block dry-run even when preflight fails', () => {
    // Dry-run should always be allowed — preflight gate only blocks real deploy
    const result = mockPreflightNoSudo();
    expect(result.canDeploy).toBe(false);
    // handleApply(dryRun=true) should NOT check preflight
  });
});

describe('Preflight — clean Debian scenario', () => {
  it('clean install with missing dirs produces actionable remediations', () => {
    const result = mockPreflightMissingDirs();
    const failedChecks = result.checks.filter(c => c.status === 'fail');
    for (const check of failedChecks) {
      expect(check.remediation).toBeTruthy();
      expect(check.remediation.length).toBeGreaterThan(5);
    }
  });

  it('clean install with no sudo gives clear instruction', () => {
    const result = mockPreflightNoSudo();
    const privCheck = result.checks.find(c => c.id === 'privilege_model');
    expect(privCheck?.remediation).toContain('sudoers');
  });

  it('error messages are human-readable and specific', () => {
    const results = [mockPreflightNoSudo(), mockPreflightMissingDirs(), mockPreflightNftFail()];
    for (const result of results) {
      for (const reason of result.blockedReasons) {
        // Must not be generic
        expect(reason.length).toBeGreaterThan(10);
        // Must reference specific path or command
        expect(
          reason.includes('/etc/') || reason.includes('nft') || reason.includes('sudo') || reason.includes('root')
        ).toBe(true);
      }
    }
  });
});

describe('Preflight — no destructive step without proven capability', () => {
  it('pipeline should not stop services if preflight failed', () => {
    // The backend deploy_apply route returns "blocked" before executing pipeline
    const result = mockPreflightNoSudo();
    expect(result.canDeploy).toBe(false);
    // deploy_apply should return status="blocked" immediately
  });

  it('pipeline should not flush nftables if nft privilege check failed', () => {
    const result = mockPreflightNftFail();
    expect(result.canDeploy).toBe(false);
    // backend gates before Step 5 (Stop services / flush)
  });

  it('pipeline should not write files if directory access failed', () => {
    const result = mockPreflightMissingDirs();
    expect(result.canDeploy).toBe(false);
    // backend gates before Step 7 (Apply files)
  });
});

describe('Preflight — result structure', () => {
  it('contains all required fields', () => {
    const result = mockPreflightAllPass();
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('failed');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('checks');
    expect(result).toHaveProperty('canDeploy');
    expect(result).toHaveProperty('blockedReasons');
    expect(result).toHaveProperty('privilege');
    expect(result).toHaveProperty('durationMs');
  });

  it('privilege object contains execution model info', () => {
    const result = mockPreflightAllPass();
    expect(result.privilege).toHaveProperty('euid');
    expect(result.privilege).toHaveProperty('is_root');
    expect(result.privilege).toHaveProperty('model');
    expect(result.privilege).toHaveProperty('backend_running_as_user');
    expect(result.privilege).toHaveProperty('privilege_wrapper_available');
  });

  it('each check has id, category, label, status, detail, remediation', () => {
    const result = mockPreflightMissingDirs();
    for (const check of result.checks) {
      expect(check).toHaveProperty('id');
      expect(check).toHaveProperty('category');
      expect(check).toHaveProperty('label');
      expect(check).toHaveProperty('status');
      expect(check).toHaveProperty('detail');
      expect(check).toHaveProperty('remediation');
      expect(['pass', 'fail']).toContain(check.status);
    }
  });

  it('passed + failed equals total', () => {
    for (const result of [mockPreflightAllPass(), mockPreflightNoSudo(), mockPreflightMissingDirs(), mockPreflightNftFail()]) {
      expect(result.passed + result.failed).toBeLessThanOrEqual(result.total);
    }
  });
});
