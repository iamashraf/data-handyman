import pytest
from fastapi.testclient import TestClient

from app.db import get_connection, init_db
from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db_conn(tmp_path):
    conn = get_connection(str(tmp_path / "test.db"))
    init_db(conn)
    yield conn
    conn.close()
