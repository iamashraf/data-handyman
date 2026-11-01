"""App-wide logging setup.

Logs to the console (same as always) and, best-effort, to a rotating file
next to the database so there's a persistent trace of failures even if
nobody was watching the terminal when they happened -- e.g. an Excel
import that failed for a reason the UI can't fully explain (a corrupt
file openpyxl chokes on, a database error partway through). Writing the
file is best-effort: a read-only or missing data directory shouldn't
block the app from starting.
"""

import logging
import logging.handlers
from pathlib import Path

from app.db import DB_PATH

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def configure_logging() -> None:
    logger = logging.getLogger("app")
    if logger.handlers:
        return  # already configured
    logger.setLevel(logging.INFO)

    formatter = logging.Formatter(LOG_FORMAT)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    try:
        log_path = Path(DB_PATH).resolve().parent / "data-handyman.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.handlers.RotatingFileHandler(
            log_path, maxBytes=5 * 1024 * 1024, backupCount=3
        )
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    except OSError:
        logger.warning("Couldn't open a log file next to the database; logging to console only.")
