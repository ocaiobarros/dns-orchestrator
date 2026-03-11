# DNS Control — Proof Checklist

Executable verification sequence. Every step includes exact commands and expected results.

---

## Prerequisites

- Python 3.11+
- Node.js 18+
- Terminal with two tabs (backend + frontend)

---

## Part 1 — Backend Startup

### 1.1 Install Python dependencies

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**Expected**: All packages install successfully. No errors.

### 1.2 Set environment and start server

```bash
export DNS_CONTROL_DB_PATH=./dns-control.db
export DNS_CONTROL_SECRET_KEY=$(openssl rand -hex 32)
export DNS_CONTROL_INITIAL_ADMIN_PASSWORD=admin

uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Expected output** (first run):
```
[DNS Control] Default admin user created: admin
[DNS Control] ⚠ must_change_password=True — password change required on first login
INFO:     Uvicorn running on http://127.0.0.1:8000
```

### 1.3 Verify health endpoint

```bash
curl -s http://localhost:8000/api/health | python3 -m json.tool
```

**Expected**:
```json
{
    "status": "ok",
    "version": "1.0.0",
    "database": "connected",
    "users": 1,
    "engine": "FastAPI + SQLite + SQLAlchemy",
    "auth": "bcrypt + JWT + server-side sessions"
}
```

### 1.4 Verify Swagger docs

Open `http://localhost:8000/docs` in a browser.

**Expected**: Interactive API documentation with all endpoint groups: Auth, Users, Dashboard, Services, Network, DNS, NAT, OSPF, Logs, Troubleshooting, Configs, Apply, Files, History, Settings.

### 1.5 Verify SQLite database was created

```bash
ls -la dns-control.db
sqlite3 dns-control.db ".tables"
```

**Expected**:
```
apply_jobs       config_profiles  config_revisions log_entries      sessions         settings         users
```

### 1.6 Verify admin user exists

```bash
sqlite3 dns-control.db "SELECT username, is_active, must_change_password FROM users;"
```

**Expected**:
```
admin|1|1
```

---

## Part 2 — Frontend Startup

### 2.1 Install Node dependencies (in a second terminal)

```bash
npm install
```

### 2.2 Start frontend in preview mode (no backend required)

```bash
npm run dev
```

**Expected**: Vite dev server starts on `http://localhost:5173`.

### 2.3 Start frontend connected to backend

```bash
VITE_API_URL=http://localhost:8000 npm run dev
```

**Expected**: Frontend calls real API endpoints instead of mock data.

### 2.4 Build for production

```bash
npm run build
```

**Expected**: Output in `dist/` directory. No build errors.

---

## Part 3 — Authentication Flow

### 3.1 Redirect to login

Open `http://localhost:5173` (or `http://localhost:5173/dashboard`).

**Expected**: Redirect to `/login`. Login form visible with "DNS Control" branding.

### 3.2 Login with default admin (backend mode)

```bash
curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | python3 -m json.tool
```

**Expected**:
```json
{
    "token": "<jwt_token>",
    "expires_at": "<timestamp>",
    "must_change_password": true,
    "user": {
        "id": "<uuid>",
        "username": "admin",
        "is_active": true,
        "must_change_password": true,
        ...
    }
}
```

### 3.3 Verify forced password change blocks access

```bash
# Save token from step 3.2
TOKEN="<token_from_above>"

curl -s http://localhost:8000/api/dashboard/summary \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**Expected**: Returns dashboard data (backend doesn't block — frontend enforces redirect). The key verification is that `must_change_password=true` is returned, and the frontend redirects to `/force-change-password`.

### 3.4 Force change password

```bash
curl -s -X POST http://localhost:8000/api/auth/force-change-password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"new_password":"NewSecure123"}' | python3 -m json.tool
```

**Expected**:
```json
{
    "success": true
}
```

### 3.5 Verify flag cleared

```bash
sqlite3 dns-control.db "SELECT must_change_password FROM users WHERE username='admin';"
```

**Expected**: `0`

### 3.6 Verify session info

```bash
curl -s http://localhost:8000/api/auth/me \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**Expected**: User info with `must_change_password: false`, session expiration timestamp.

### 3.7 Refresh session

```bash
curl -s -X POST http://localhost:8000/api/auth/refresh \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**Expected**: `{ "expires_at": "<new_timestamp>" }`

### 3.8 Logout

```bash
curl -s -X POST http://localhost:8000/api/auth/logout \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**Expected**: `{ "success": true }`

### 3.9 Verify token is invalidated

```bash
curl -s http://localhost:8000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**: `401 Unauthorized` — session is no longer valid.

---

## Part 4 — User Management

### 4.1 Login again (with new password)

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"NewSecure123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
```

### 4.2 Create a new user

```bash
curl -s -X POST http://localhost:8000/api/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"username":"operador","password":"Oper1234","must_change_password":false}' | python3 -m json.tool
```

**Expected**: 201 with user object. Save the returned `id`.

### 4.3 List users

```bash
curl -s http://localhost:8000/api/users \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**Expected**: Array with 2 users: `admin` and `operador`.

### 4.4 Login with new user

```bash
curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"operador","password":"Oper1234"}' | python3 -m json.tool
```

**Expected**: Successful login with `must_change_password: false`.

### 4.5 Disable user

```bash
USER_ID="<id_from_step_4.2>"

curl -s -X POST http://localhost:8000/api/users/$USER_ID/disable \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**Expected**: `{ "success": true }`

### 4.6 Verify disabled user cannot login

```bash
curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"operador","password":"Oper1234"}'
```

**Expected**: `403 Forbidden` — "Usuário desativado"

### 4.7 Re-enable user

```bash
curl -s -X POST http://localhost:8000/api/users/$USER_ID/enable \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**Expected**: `{ "success": true }`

### 4.8 Change user password (admin action)

```bash
curl -s -X POST http://localhost:8000/api/users/$USER_ID/change-password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"password":"NewOper567"}' | python3 -m json.tool
```

**Expected**: `{ "success": true }`

### 4.9 Delete user

```bash
curl -s -X DELETE http://localhost:8000/api/users/$USER_ID \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**Expected**: `{ "success": true }`

### 4.10 Verify deletion

```bash
curl -s http://localhost:8000/api/users \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**Expected**: Array with 1 user: `admin` only.

---

## Part 5 — Validation Checks

### 5.1 Duplicate username rejected

```bash
curl -s -X POST http://localhost:8000/api/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"username":"admin","password":"Test1234"}'
```

**Expected**: `409 Conflict` — "Usuário já existe"

### 5.2 Weak password rejected

```bash
curl -s -X POST http://localhost:8000/api/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"username":"fraco","password":"123"}'
```

**Expected**: `400 Bad Request` — password too short

### 5.3 Invalid credentials rejected

```bash
curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"wrongpassword"}'
```

**Expected**: `401 Unauthorized` — "Credenciais inválidas"

### 5.4 Unauthenticated request rejected

```bash
curl -s http://localhost:8000/api/users
```

**Expected**: `401 Unauthorized` — "Token de autenticação não fornecido"

---

## Part 6 — Frontend UI Verification

Navigate through each route and confirm rendering:

| Route | Expected |
|---|---|
| `/login` | Login form with "DNS Control" title |
| `/force-change-password` | Password change form (only if `mustChangePassword=true`) |
| `/` or `/dashboard` | Dashboard with service status, metrics cards |
| `/wizard` | Configuration wizard with tabs |
| `/services` | Service list with status indicators |
| `/network` | Network interfaces and routing table |
| `/dns` | DNS metrics and instance list |
| `/nat` | NAT/nftables counters and ruleset |
| `/ospf` | OSPF neighbors and routes |
| `/logs` | Log viewer with source/level filters |
| `/troubleshoot` | Diagnostic commands and health check |
| `/files` | Generated config files list |
| `/history` | Apply job history |
| `/settings` | Application settings |
| `/users` | User management table with actions |

### Session timeout test

1. Login to the app
2. Wait until `session_timeout - warning_seconds` (default: 28 minutes, or reduce timeout for testing)
3. **Expected**: Modal appears with countdown
4. Click "Continuar conectado" → session refreshed, modal closes
5. Let countdown reach 0 → auto-logout, redirect to `/login`

---

## Part 7 — Security Spot Checks

### 7.1 No shell=True in codebase

```bash
grep -rn "shell=True" backend/
```

**Expected**: No results.

### 7.2 Whitelist enforcement

```bash
grep -n "ALLOWED_EXECUTABLES" backend/app/executors/command_runner.py
```

**Expected**: `frozenset` with specific commands.

### 7.3 No hardcoded secrets

```bash
grep -rn "password.*=.*['\"]" backend/app/core/ backend/app/api/ backend/app/services/ | grep -v "password_hash" | grep -v "change-me" | grep -v "#" | grep -v "def " | grep -v "current_password" | grep -v "new_password" | grep -v "plain_password"
```

**Expected**: No results with actual credentials.

### 7.4 bcrypt in use

```bash
grep -rn "bcrypt" backend/app/core/security.py
```

**Expected**: `CryptContext(schemes=["bcrypt"]...)`

---

## Quick Reset

To start fresh:

```bash
cd backend
rm -f dns-control.db
# Restart uvicorn — database and admin will be recreated
```
