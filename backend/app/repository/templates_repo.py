import json
import sqlite3
from datetime import UTC, datetime

from app.models.template import TemplateColumn, TemplateRead

_COLUMNS_SQL = "id, name, schema, created_at, updated_at"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _serialize_columns(columns: list[TemplateColumn]) -> str:
    return json.dumps([c.model_dump() for c in columns])


def _row_to_template(row: tuple) -> TemplateRead:
    template_id, name, schema, created_at, updated_at = row
    return TemplateRead(
        id=template_id,
        name=name,
        columns=[TemplateColumn(**c) for c in json.loads(schema)],
        created_at=created_at,
        updated_at=updated_at,
    )


def create_template(
    conn: sqlite3.Connection, name: str, columns: list[TemplateColumn]
) -> TemplateRead:
    now = _now()
    cursor = conn.execute(
        "INSERT INTO templates (name, schema, created_at, updated_at) "
        "VALUES (?, ?, ?, ?)",
        (name, _serialize_columns(columns), now, now),
    )
    conn.commit()
    return get_template(conn, cursor.lastrowid)


def get_template(conn: sqlite3.Connection, template_id: int) -> TemplateRead | None:
    row = conn.execute(
        f"SELECT {_COLUMNS_SQL} FROM templates WHERE id = ?", (template_id,)
    ).fetchone()
    return _row_to_template(row) if row else None


def list_templates(conn: sqlite3.Connection) -> list[TemplateRead]:
    rows = conn.execute(f"SELECT {_COLUMNS_SQL} FROM templates ORDER BY id").fetchall()
    return [_row_to_template(row) for row in rows]


def update_template(
    conn: sqlite3.Connection,
    template_id: int,
    name: str,
    columns: list[TemplateColumn],
) -> TemplateRead:
    conn.execute(
        "UPDATE templates SET name = ?, schema = ?, updated_at = ? WHERE id = ?",
        (name, _serialize_columns(columns), _now(), template_id),
    )
    conn.commit()
    template = get_template(conn, template_id)
    if template is None:
        raise LookupError(f"template {template_id} not found")
    return template


def delete_template(conn: sqlite3.Connection, template_id: int) -> None:
    conn.execute("DELETE FROM templates WHERE id = ?", (template_id,))
    conn.commit()
