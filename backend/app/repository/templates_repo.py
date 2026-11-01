import json
import sqlite3
from datetime import UTC, datetime

from app.models.template import TemplateColumn, TemplateRead, UniqueConstraint

_COLUMNS_SQL = "id, name, schema, created_at, updated_at"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _serialize_schema(
    columns: list[TemplateColumn], unique_constraints: list[UniqueConstraint]
) -> str:
    return json.dumps(
        {
            "columns": [c.model_dump() for c in columns],
            "unique_constraints": [u.model_dump() for u in unique_constraints],
        }
    )


def _row_to_template(row: tuple) -> TemplateRead:
    template_id, name, schema, created_at, updated_at = row
    raw = json.loads(schema)
    # A template saved before unique constraints existed stored `schema` as
    # a bare column array -- read that shape as "no constraints" instead of
    # requiring a migration.
    if isinstance(raw, list):
        columns_raw, constraints_raw = raw, []
    else:
        columns_raw, constraints_raw = raw.get("columns", []), raw.get("unique_constraints", [])
    return TemplateRead(
        id=template_id,
        name=name,
        columns=[TemplateColumn(**c) for c in columns_raw],
        unique_constraints=[UniqueConstraint(**u) for u in constraints_raw],
        created_at=created_at,
        updated_at=updated_at,
    )


def create_template(
    conn: sqlite3.Connection,
    name: str,
    columns: list[TemplateColumn],
    unique_constraints: list[UniqueConstraint] | None = None,
) -> TemplateRead:
    now = _now()
    cursor = conn.execute(
        "INSERT INTO templates (name, schema, created_at, updated_at) "
        "VALUES (?, ?, ?, ?)",
        (name, _serialize_schema(columns, unique_constraints or []), now, now),
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
    unique_constraints: list[UniqueConstraint] | None = None,
) -> TemplateRead:
    conn.execute(
        "UPDATE templates SET name = ?, schema = ?, updated_at = ? WHERE id = ?",
        (name, _serialize_schema(columns, unique_constraints or []), _now(), template_id),
    )
    conn.commit()
    template = get_template(conn, template_id)
    if template is None:
        raise LookupError(f"template {template_id} not found")
    return template


def delete_template(conn: sqlite3.Connection, template_id: int) -> None:
    conn.execute("DELETE FROM templates WHERE id = ?", (template_id,))
    conn.commit()
