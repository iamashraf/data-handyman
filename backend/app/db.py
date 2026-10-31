import os
import sqlite3
from collections.abc import Iterator

# On-disk database path for running the app outside of tests, overridable
# via the DB_PATH env var (the production container points this at its
# mounted data volume).
DB_PATH = os.environ.get("DB_PATH", "/data/handy_recorder.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY,
    name TEXT,
    schema TEXT,
    created_at TEXT,
    updated_at TEXT
);
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY,
    template_id INTEGER,
    data TEXT,
    created_at TEXT,
    updated_at TEXT
);
"""


def get_connection(db_path: str) -> sqlite3.Connection:
    return sqlite3.connect(db_path, check_same_thread=False)


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def get_db() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency yielding a request-scoped connection.

    Tests override this (see `tests/conftest.py`) so routes run against an
    isolated, already-initialized `db_conn` fixture instead of this default.
    """
    conn = get_connection(DB_PATH)
    try:
        yield conn
    finally:
        conn.close()
