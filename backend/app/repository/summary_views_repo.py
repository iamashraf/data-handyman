import json
import sqlite3
from datetime import UTC, datetime

from app.models.summary import SummaryViewCreate, SummaryViewRead

_COLUMNS_SQL = "id, template_id, name, group_by, metric, chart_type, created_at, updated_at"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _row_to_view(row: tuple) -> SummaryViewRead:
    view_id, template_id, name, group_by, metric, chart_type, created_at, updated_at = row
    return SummaryViewRead(
        id=view_id,
        template_id=template_id,
        name=name,
        group_by=json.loads(group_by),
        metric=metric,
        chart_type=chart_type,
        created_at=created_at,
        updated_at=updated_at,
    )


def create_view(
    conn: sqlite3.Connection, template_id: int, view: SummaryViewCreate
) -> SummaryViewRead:
    now = _now()
    cursor = conn.execute(
        "INSERT INTO summary_views "
        "(template_id, name, group_by, metric, chart_type, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (template_id, view.name, json.dumps(view.group_by), view.metric, view.chart_type, now, now),
    )
    conn.commit()
    row = conn.execute(
        f"SELECT {_COLUMNS_SQL} FROM summary_views WHERE id = ?", (cursor.lastrowid,)
    ).fetchone()
    return _row_to_view(row)


def list_views(conn: sqlite3.Connection, template_id: int) -> list[SummaryViewRead]:
    rows = conn.execute(
        f"SELECT {_COLUMNS_SQL} FROM summary_views WHERE template_id = ? ORDER BY id",
        (template_id,),
    ).fetchall()
    return [_row_to_view(row) for row in rows]


def get_view(conn: sqlite3.Connection, view_id: int) -> SummaryViewRead | None:
    row = conn.execute(
        f"SELECT {_COLUMNS_SQL} FROM summary_views WHERE id = ?", (view_id,)
    ).fetchone()
    return _row_to_view(row) if row else None


def delete_view(conn: sqlite3.Connection, view_id: int) -> None:
    conn.execute("DELETE FROM summary_views WHERE id = ?", (view_id,))
    conn.commit()


def delete_views_by_template(conn: sqlite3.Connection, template_id: int) -> None:
    """Deletes every saved view under a template -- used when the template
    itself is deleted, since there's no FK/cascade at the schema level and
    these views would otherwise become permanently orphaned: invisible, but
    still occupying the database, and liable to attach themselves to a
    *different*, unrelated template if sqlite later reuses the deleted
    template's id (ids aren't `AUTOINCREMENT`, so a freed id can be
    reassigned), surfacing as a saved view whose group_by columns don't
    exist on the new template at all."""
    conn.execute("DELETE FROM summary_views WHERE template_id = ?", (template_id,))
    conn.commit()
