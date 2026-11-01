IMAGE := data-handyman-dev

.PHONY: lint test

lint:
	podman run --rm -v $(CURDIR)/backend:/app -w /app $(IMAGE) sh -c "uv run ruff check . && uv run black --check ."

test:
	podman run --rm -v $(CURDIR)/backend:/app -w /app $(IMAGE) uv run pytest -v
