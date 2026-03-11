# DNS Control — Backend

FastAPI backend for DNS Control infrastructure management on Debian 13.

## Quick Start

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Set required env vars
export DNS_CONTROL_SECRET_KEY=$(openssl rand -hex 32)
export DNS_CONTROL_INITIAL_ADMIN_PASSWORD=changeme
export DNS_CONTROL_DB_PATH=./dns-control.db

# Start server (auto-creates DB and admin user)
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DNS_CONTROL_DB_PATH` | `/var/lib/dns-control/dns-control.db` | SQLite database path |
| `DNS_CONTROL_SECRET_KEY` | (change me) | JWT signing key |
| `DNS_CONTROL_SESSION_TIMEOUT_MINUTES` | `30` | Session duration |
| `DNS_CONTROL_SESSION_WARNING_SECONDS` | `120` | Warning before expiry |
| `DNS_CONTROL_INITIAL_ADMIN_USERNAME` | `admin` | Default admin username |
| `DNS_CONTROL_INITIAL_ADMIN_PASSWORD` | `admin` | Default admin password |
| `DNS_CONTROL_HOST` | `127.0.0.1` | API bind address |
| `DNS_CONTROL_PORT` | `8000` | API port |

## API Documentation

Start the server and visit `http://localhost:8000/docs` for interactive Swagger documentation.
