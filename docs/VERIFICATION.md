# DNS Control — Verification Report

Generated: 2026-03-11

## 1. Backend Files — Verified Present

### Core
- `backend/app/main.py` — FastAPI entry point, includes all routers
- `backend/app/core/config.py` — Settings from environment variables
- `backend/app/core/security.py` — bcrypt hashing, JWT tokens, password validation
- `backend/app/core/database.py` — SQLAlchemy engine, session factory, init_db()
- `backend/app/core/sessions.py` — Server-side session create/validate/refresh/invalidate
- `backend/app/core/logging.py` — Structured audit logging to database

### Models (SQLAlchemy)
- `backend/app/models/user.py` — id, username, password_hash, is_active, must_change_password, timestamps
- `backend/app/models/session.py` — id, user_id, session_token, expires_at, is_active, client_ip
- `backend/app/models/config_profile.py` — id, name, description, payload_json, created_by, timestamps
- `backend/app/models/config_revision.py` — id, profile_id, revision_number, payload_json
- `backend/app/models/apply_job.py` — id, profile_id, job_type, status, stdout/stderr, exit_code
- `backend/app/models/log_entry.py` — id, source, level, message, context_json + Settings table

### Schemas (Pydantic)
- `backend/app/schemas/auth.py` — LoginRequest/Response, SessionInfo, ChangePassword, ForceChangePassword
- `backend/app/schemas/user.py` — CreateUser, UpdateUser, AdminChangePassword, UserList
- `backend/app/schemas/config.py` — ConfigProfile CRUD, ApplyRequest, ApplyJob, ConfigDiff
- `backend/app/schemas/diagnostics.py` — CommandResult, ServiceStatus, NetworkInterface, Route, HealthCheck
- `backend/app/schemas/metrics.py` — DnsMetrics, NatCounters, OspfNeighbor, DashboardSummary
- `backend/app/schemas/common.py` — ApiResponse, PaginatedResponse, LogEntry, Settings

### API Routes (15 routers)
- `backend/app/api/routes/auth.py` — POST login, logout, refresh, change-password, force-change-password; GET me
- `backend/app/api/routes/users.py` — GET list, POST create, PATCH update, POST change-password/disable/enable, DELETE
- `backend/app/api/routes/dashboard.py` — GET summary
- `backend/app/api/routes/services.py` — GET list, GET detail, POST restart, GET logs
- `backend/app/api/routes/network.py` — GET interfaces, routes, reachability
- `backend/app/api/routes/dns.py` — GET summary, metrics, instances, top-domains, rcode-breakdown
- `backend/app/api/routes/nat.py` — GET summary, backends, sticky, ruleset
- `backend/app/api/routes/ospf.py` — GET summary, neighbors, routes, running-config
- `backend/app/api/routes/logs.py` — GET list (paginated, filtered), GET export
- `backend/app/api/routes/troubleshooting.py` — GET commands, POST run, GET health-check
- `backend/app/api/routes/configs.py` — Full CRUD, clone, preview, files, diff, history
- `backend/app/api/routes/apply.py` — POST dry-run, full, dns, network, frr, nftables; GET jobs
- `backend/app/api/routes/files.py` — GET generated files list and content
- `backend/app/api/routes/history.py` — GET paginated job history
- `backend/app/api/routes/settings.py` — GET and PATCH key-value settings

### Services (9 modules)
- `backend/app/services/auth_service.py` — authenticate_user, set_password
- `backend/app/services/user_service.py` — get_all_users, get_by_id/username, exists check
- `backend/app/services/config_service.py` — validate_config, generate_preview, diff_configs
- `backend/app/services/apply_service.py` — execute_apply (validate→generate→backup→write→restart)
- `backend/app/services/diagnostics_service.py` — system status, health checks, network info
- `backend/app/services/metrics_service.py` — DNS/NAT/OSPF metrics from system commands
- `backend/app/services/command_service.py` — run_whitelisted_command, get_available_commands
- `backend/app/services/filegen_service.py` — orchestrate file generation
- `backend/app/services/history_service.py` — query apply jobs

### Executors
- `backend/app/executors/command_runner.py` — subprocess with shell=False, ALLOWED_EXECUTABLES whitelist, sanitization
- `backend/app/executors/command_catalog.py` — 24 pre-defined commands across 6 categories
- `backend/app/executors/validators.py` — IP, CIDR, interface, service, domain, port validation

### Generators
- `backend/app/generators/unbound_generator.py` — Per-instance unbound.conf generation
- `backend/app/generators/nftables_generator.py` — /etc/nftables.conf with DNAT, rate limiting, counters
- `backend/app/generators/frr_generator.py` — /etc/frr/frr.conf and daemons file
- `backend/app/generators/network_generator.py` — ifupdown2 loopback config and post-up script
- `backend/app/generators/systemd_generator.py` — Per-instance Unbound units and API service unit

### Database
- `backend/app/db/init.sql` — Complete CREATE TABLE statements with indexes
- `backend/app/db/seed.py` — Creates default admin with must_change_password=true

### Scripts
- `backend/app/scripts/install_debian13.sh` — Full Debian 13 installer (8 steps)
- `backend/app/scripts/apply_config.sh` — Manual config apply fallback
- `backend/app/scripts/run_diagnostics.sh` — CLI system health check
- `backend/app/scripts/create_admin.py` — Standalone admin creation/reset

## 2. Security Verification

| Check | Result |
|---|---|
| `shell=True` anywhere | ✗ Not found. Only `shell=False` with comment "NEVER use shell=True" |
| Arbitrary command execution | ✗ Blocked. `ALLOWED_EXECUTABLES` frozenset whitelist enforced |
| Argument sanitization | ✓ `_sanitize_arg()` strips shell metacharacters from all args |
| Password hashing | ✓ bcrypt via `passlib.context.CryptContext` |
| Hardcoded credentials | ✗ Config defaults are env-overridable, `must_change_password=True` enforces change |
| Frontend-only fake auth | ✗ Preview mode is isolated behind `IS_PREVIEW` flag; production uses real API |

## 3. Database Tables

| Table | Fields |
|---|---|
| `users` | id, username, password_hash, is_active, must_change_password, created_at, updated_at, last_login_at |
| `sessions` | id, user_id, session_token, created_at, expires_at, last_seen_at, is_active, client_ip, user_agent |
| `config_profiles` | id, name, description, payload_json, created_by, created_at, updated_at |
| `config_revisions` | id, profile_id, revision_number, payload_json, generated_files_json, created_by, created_at |
| `apply_jobs` | id, profile_id, revision_id, job_type, status, started_at, finished_at, stdout_log, stderr_log, exit_code, created_by |
| `log_entries` | id, source, level, message, context_json, created_at |
| `settings` | id, key, value, updated_at |

## 4. Required Environment Variables

| Variable | Default | Required |
|---|---|---|
| `DNS_CONTROL_DB_PATH` | `/var/lib/dns-control/dns-control.db` | No |
| `DNS_CONTROL_SECRET_KEY` | `change-me-...` | **Yes (production)** |
| `DNS_CONTROL_SESSION_TIMEOUT_MINUTES` | `30` | No |
| `DNS_CONTROL_SESSION_WARNING_SECONDS` | `120` | No |
| `DNS_CONTROL_INITIAL_ADMIN_USERNAME` | `admin` | No |
| `DNS_CONTROL_INITIAL_ADMIN_PASSWORD` | `admin` | **Yes (first setup)** |
| `DNS_CONTROL_HOST` | `127.0.0.1` | No |
| `DNS_CONTROL_PORT` | `8000` | No |
| `VITE_API_URL` | *(empty = preview mode)* | **Yes (production frontend)** |

## 5. Running Locally

### Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
export DNS_CONTROL_SECRET_KEY=$(openssl rand -hex 32)
export DNS_CONTROL_DB_PATH=./dns-control.db
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend (connected to backend)
```bash
npm install
VITE_API_URL=http://localhost:8000 npm run dev
```

### Frontend (preview mode with mock data)
```bash
npm install
npm run dev
```

## 6. Preview Mode Isolation

The frontend distinguishes preview mode from production via `VITE_API_URL`:

- **`VITE_API_URL` not set** → Preview mode: uses mock data, sessionStorage-based auth, simulated flows
- **`VITE_API_URL` set** → Production mode: all requests go to real FastAPI backend

Preview-specific behaviors (isolated in `src/lib/auth.tsx`):
- Mock login accepts any non-empty credentials
- `admin/admin` specifically triggers `mustChangePassword=true` to demonstrate the flow
- Session data stored in `sessionStorage` (not `localStorage`)
- Preview hint text only shown on login page when in preview mode
- All mock API responses routed through `src/lib/api.ts` `getMockResponse()`

**No preview code affects production behavior.** The `IS_PREVIEW` flag gates all mock paths.

## 7. Auth Flow — Verified

| Flow | Status |
|---|---|
| Unauthenticated → redirects to /login | ✓ Verified |
| Login with admin/admin → forced password change | ✓ Verified in browser |
| Password change → dashboard access | ✓ Verified in browser |
| Protected routes block mustChangePassword users | ✓ ProtectedRoute redirects to /force-change-password |
| Login with other/password → direct dashboard access | ✓ Code verified |
| Logout clears session | ✓ Code verified |
| Session timeout warning modal | ✓ Component implemented with countdown |
| Session expiry auto-logout | ✓ Timer invalidates session and clears state |
| User management page | ✓ Create, toggle, delete, change password |
