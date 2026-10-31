from fastapi import FastAPI

from app.routers import records, summary, templates

# Note: calling `init_db` on startup against a real on-disk DB_PATH is
# Task 11's job (production container wiring), not this task's.
app = FastAPI()
app.include_router(templates.router)
app.include_router(records.router)
app.include_router(summary.router)


@app.get("/health")
def health():
    return {"status": "ok"}
