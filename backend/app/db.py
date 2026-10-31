import sqlite3

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
