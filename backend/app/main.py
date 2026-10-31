from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db import DB_PATH, get_connection, init_db
from app.routers import export_import, records, summary, templates


@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = get_connection(DB_PATH)
    try:
        init_db(conn)
    finally:
        conn.close()
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(templates.router)
app.include_router(records.router)
app.include_router(summary.router)
app.include_router(export_import.router)


@app.get("/health")
def health():
    return {"status": "ok"}
