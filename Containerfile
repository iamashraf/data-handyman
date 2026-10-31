# Production container for the backend (backend-only for now — Plan 2 will
# extend this to a multi-stage build that also builds the frontend).
#
# Build:
#   podman build -t handy-recorder-backend .
#
# Run (with a named volume so data persists across restarts):
#   podman run --rm -d -p 8000:8000 -v handy-recorder-data:/data \
#     --name hr-backend handy-recorder-backend

FROM python:3.12-slim

RUN pip install --no-cache-dir uv==0.13.5

WORKDIR /app

# Install dependencies first so they're cached independently of app code.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev

COPY backend/app ./app

RUN mkdir -p /data

EXPOSE 8000
CMD ["uv", "run", "--no-dev", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
