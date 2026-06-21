"""
DNS Control — Versioned schema migrations registry.

Each migration is (version: str, fn: callable(raw_connection) -> None).
Migrations MUST be ADDITIVE (CREATE TABLE / ADD COLUMN). NEVER destructive.
Logical rollback helpers (`down_*`) are provided for tests; production
rollback is operational, not automatic.

For tables already defined as SQLAlchemy models, `Base.metadata.create_all`
creates them on fresh DBs. The entries here exist to (a) record the schema
version in `schema_migrations`, and (b) idempotently CREATE the tables on
legacy DBs created before the model was added.
"""

POL_1_TABLES_SQL = [
    """
    CREATE TABLE IF NOT EXISTS policy_tenants (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL UNIQUE,
        description  TEXT,
        created_at   TIMESTAMP NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS policy_views (
        id           TEXT PRIMARY KEY,
        tenant_id    TEXT NOT NULL REFERENCES policy_tenants(id) ON DELETE CASCADE,
        name         TEXT NOT NULL UNIQUE,
        cidrs_json   TEXT NOT NULL DEFAULT '[]',
        is_default   INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMP NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS policy_rules (
        id           TEXT PRIMARY KEY,
        scope_view   TEXT REFERENCES policy_views(id) ON DELETE SET NULL,
        kind         TEXT NOT NULL,
        target       TEXT NOT NULL,
        action       TEXT NOT NULL,
        payload_json TEXT,
        source       TEXT NOT NULL DEFAULT 'operator',
        source_ref   TEXT,
        layer        INTEGER NOT NULL,
        enabled      INTEGER NOT NULL DEFAULT 1,
        created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at   TIMESTAMP NOT NULL,
        updated_at   TIMESTAMP NOT NULL,
        CONSTRAINT ck_policy_rules_kind CHECK (kind IN ('block_name','override_data','allow_exception','feed_rule')),
        CONSTRAINT ck_policy_rules_source CHECK (source IN ('operator','feed','anablock_mirror')),
        CONSTRAINT ck_policy_rules_layer CHECK (layer IN (100,200,300,400,999)),
        CONSTRAINT ck_policy_rules_kind_layer_400 CHECK ((kind = 'allow_exception') = (layer = 400)),
        CONSTRAINT ck_policy_rules_layer_100_judicial CHECK ((layer = 100) = (source = 'anablock_mirror')),
        CONSTRAINT ck_policy_rules_allow_not_judicial CHECK (NOT (kind = 'allow_exception' AND source = 'anablock_mirror')),
        CONSTRAINT uq_policy_rules_scope_kind_target_source UNIQUE (scope_view, kind, target, source)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_policy_rules_scope_view ON policy_rules(scope_view)",
    "CREATE INDEX IF NOT EXISTS ix_policy_rules_layer ON policy_rules(layer)",
    "CREATE INDEX IF NOT EXISTS ix_policy_rules_target ON policy_rules(target)",
    "CREATE INDEX IF NOT EXISTS ix_policy_rules_enabled ON policy_rules(enabled)",
    """
    CREATE TABLE IF NOT EXISTS policy_feed_sources (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL UNIQUE,
        kind         TEXT NOT NULL,
        url          TEXT NOT NULL,
        auth_header  TEXT,
        integrity    TEXT NOT NULL DEFAULT 'sha256_sidecar',
        cadence_sec  INTEGER NOT NULL DEFAULT 3600,
        enabled      INTEGER NOT NULL DEFAULT 1,
        is_judicial  INTEGER NOT NULL DEFAULT 0,
        last_version TEXT,
        last_status  TEXT,
        last_sync_at TIMESTAMP,
        created_at   TIMESTAMP NOT NULL,
        CONSTRAINT ck_policy_feed_kind CHECK (kind IN ('domain_blocklist','ip_blocklist','reputation')),
        CONSTRAINT ck_policy_feed_integrity CHECK (integrity IN ('sha256_sidecar','signed_manifest','none'))
    )
    """,
]


def _migration_pol_1_policy_plane_foundation(raw_conn) -> None:
    """POL-1: create policy plane tables (additive, idempotent)."""
    cur = raw_conn.cursor()
    for stmt in POL_1_TABLES_SQL:
        cur.execute(stmt)


def down_pol_1_policy_plane_foundation(raw_conn) -> None:
    """Logical rollback for POL-1 (tests; not wired automatically)."""
    cur = raw_conn.cursor()
    for tbl in ("policy_rules", "policy_views", "policy_tenants", "policy_feed_sources"):
        cur.execute(f"DROP TABLE IF EXISTS {tbl}")
    cur.execute("DELETE FROM schema_migrations WHERE version = ?", ("pol_1_policy_plane_foundation",))


MIGRATIONS = [
    ("pol_1_policy_plane_foundation", _migration_pol_1_policy_plane_foundation),
]
