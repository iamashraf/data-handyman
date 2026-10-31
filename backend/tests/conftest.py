import pytest
from fastapi.testclient import TestClient

from app.db import get_connection, get_db, init_db
from app.main import app


@pytest.fixture
def db_conn(tmp_path):
    conn = get_connection(str(tmp_path / "test.db"))
    init_db(conn)
    yield conn
    conn.close()


@pytest.fixture
def client(db_conn):
    # Override the app's DB dependency so API requests made through this
    # client see the same connection/data as the db_conn fixture.
    app.dependency_overrides[get_db] = lambda: db_conn
    yield TestClient(app)
    app.dependency_overrides.clear()
