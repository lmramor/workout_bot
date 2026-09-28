import json
import sqlite3
from contextlib import closing

from config import DB_PATH


def _connect() -> sqlite3.Connection:
    return sqlite3.connect(DB_PATH)


def init_db() -> None:
    with closing(_connect()) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS workout_plans (
                user_id INTEGER PRIMARY KEY,
                survey TEXT NOT NULL,
                url_param TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.commit()


def save_plan(user_id: int, survey: dict, url_param: str, source: str) -> None:
    with closing(_connect()) as conn:
        conn.execute(
            """
            INSERT INTO workout_plans (user_id, survey, url_param, source, created_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
                survey = excluded.survey,
                url_param = excluded.url_param,
                source = excluded.source,
                created_at = CURRENT_TIMESTAMP
            """,
            (user_id, json.dumps(survey, ensure_ascii=False), url_param, source),
        )
        conn.commit()


def get_plan_param(user_id: int) -> str | None:
    with closing(_connect()) as conn:
        row = conn.execute("SELECT url_param FROM workout_plans WHERE user_id = ?", (user_id,)).fetchone()
    return row[0] if row else None
