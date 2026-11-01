from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

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


# Serve the frontend's built static files, if present (the production
# image builds them in; a standalone backend-only run, or the test suite,
# has no "static" directory and simply skips this). Mounted last so it
# never shadows the API routes above.
_static_dir = Path(__file__).resolve().parent.parent / "static"
if _static_dir.is_dir():
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")
