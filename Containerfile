# Production container for the full stack: FastAPI serves both the API
# and the frontend's built static files from one process, one port.
#
# Build:
#   podman build -t data-handyman .
#
# Run (with a named volume so data persists across restarts):
#   podman run --rm -d -p 8000:8000 -v data-handyman-data:/data \
#     --name data-handyman data-handyman

FROM node:26-slim AS frontend-build

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim

RUN pip install --no-cache-dir uv==0.13.5

WORKDIR /app

# Install dependencies first so they're cached independently of app code.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev

COPY backend/app ./app
COPY --from=frontend-build /app/dist ./static

RUN mkdir -p /data

EXPOSE 8000
CMD ["uv", "run", "--no-dev", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
