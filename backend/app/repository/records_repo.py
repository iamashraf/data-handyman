import json
import sqlite3
from datetime import UTC, datetime

from app.models.record import RecordRaw

_COLUMNS_SQL = "id, template_id, data, created_at, updated_at"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _row_to_record(row: tuple) -> RecordRaw:
    record_id, template_id, data, created_at, updated_at = row
    return RecordRaw(
        id=record_id,
        template_id=template_id,
        data=json.loads(data),
        created_at=created_at,
        updated_at=updated_at,
    )


def create_record(conn: sqlite3.Connection, template_id: int, data: dict) -> RecordRaw:
    now = _now()
    cursor = conn.execute(
        "INSERT INTO records (template_id, data, created_at, updated_at) "
        "VALUES (?, ?, ?, ?)",
        (template_id, json.dumps(data), now, now),
    )
    conn.commit()
    return get_record(conn, cursor.lastrowid)


def get_record(conn: sqlite3.Connection, record_id: int) -> RecordRaw | None:
    row = conn.execute(
        f"SELECT {_COLUMNS_SQL} FROM records WHERE id = ?", (record_id,)
    ).fetchone()
    return _row_to_record(row) if row else None


def list_records(conn: sqlite3.Connection, template_id: int) -> list[RecordRaw]:
    rows = conn.execute(
        f"SELECT {_COLUMNS_SQL} FROM records WHERE template_id = ? ORDER BY id",
        (template_id,),
    ).fetchall()
    return [_row_to_record(row) for row in rows]


def update_record(conn: sqlite3.Connection, record_id: int, data: dict) -> RecordRaw:
    conn.execute(
        "UPDATE records SET data = ?, updated_at = ? WHERE id = ?",
        (json.dumps(data), _now(), record_id),
    )
    conn.commit()
    record = get_record(conn, record_id)
    if record is None:
        raise LookupError(f"record {record_id} not found")
    return record


def delete_record(conn: sqlite3.Connection, record_id: int) -> None:
    conn.execute("DELETE FROM records WHERE id = ?", (record_id,))
    conn.commit()
