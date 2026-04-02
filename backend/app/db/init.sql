-- DNS Control — SQLite Schema Bootstrap
-- Run this file to initialize the database manually if needed.
-- The application will auto-create tables on first startup via SQLAlchemy.

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    is_active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    last_login_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    last_seen_at TEXT DEFAULT (datetime('now')),
    is_active INTEGER NOT NULL DEFAULT 1,
    client_ip TEXT DEFAULT '',
    user_agent TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);

CREATE TABLE IF NOT EXISTS config_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    payload_json TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_config_profiles_name ON config_profiles(name);

CREATE TABLE IF NOT EXISTS config_revisions (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES config_profiles(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    generated_files_json TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_config_revisions_profile ON config_revisions(profile_id);

CREATE TABLE IF NOT EXISTS apply_jobs (
    id TEXT PRIMARY KEY,
    profile_id TEXT REFERENCES config_profiles(id) ON DELETE SET NULL,
    revision_id TEXT REFERENCES config_revisions(id) ON DELETE SET NULL,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    finished_at TEXT,
    stdout_log TEXT DEFAULT '',
    stderr_log TEXT DEFAULT '',
    exit_code INTEGER,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS log_entries (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    context_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_log_entries_source ON log_entries(source);
CREATE INDEX IF NOT EXISTS idx_log_entries_level ON log_entries(level);
CREATE INDEX IF NOT EXISTS idx_log_entries_created ON log_entries(created_at);

CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
