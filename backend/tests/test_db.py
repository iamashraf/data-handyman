from app.db import get_connection, init_db


def test_init_db_creates_tables(tmp_path):
    conn = get_connection(str(tmp_path / "test.db"))
    init_db(conn)
    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert {"templates", "records"}.issubset(tables)
