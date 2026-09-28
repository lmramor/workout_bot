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
    init_reminders()


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


# ---------- напоминания ----------

def init_reminders() -> None:
    with closing(_connect()) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS reminders (
                user_id INTEGER PRIMARY KEY,
                days TEXT NOT NULL,          -- дни недели через запятую, 0 = понедельник
                time TEXT NOT NULL,          -- «ЧЧ:ММ» по времени компьютера, где запущен бот
                enabled INTEGER NOT NULL DEFAULT 1,
                last_sent TEXT               -- дата последней отправки, чтобы не слать дважды
            )
            """
        )
        conn.commit()


def get_reminder(user_id: int) -> dict | None:
    with closing(_connect()) as conn:
        row = conn.execute("SELECT days, time, enabled FROM reminders WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        return None
    return {"days": [int(d) for d in row[0].split(",") if d], "time": row[1], "enabled": bool(row[2])}


def set_reminder(user_id: int, days: list[int], time: str, enabled: bool = True) -> None:
    with closing(_connect()) as conn:
        conn.execute(
            """
            INSERT INTO reminders (user_id, days, time, enabled) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET days = excluded.days, time = excluded.time, enabled = excluded.enabled
            """,
            (user_id, ",".join(str(d) for d in sorted(set(days))), time, int(enabled)),
        )
        conn.commit()


def due_reminders(weekday: int, time: str, today: str) -> list[int]:
    """Кому пора напомнить прямо сейчас (и кому сегодня ещё не напоминали)."""
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT user_id, days FROM reminders WHERE enabled = 1 AND time = ? AND (last_sent IS NULL OR last_sent != ?)",
            (time, today),
        ).fetchall()
    return [uid for uid, days in rows if str(weekday) in days.split(",")]


def mark_reminded(user_id: int, today: str) -> None:
    with closing(_connect()) as conn:
        conn.execute("UPDATE reminders SET last_sent = ? WHERE user_id = ?", (today, user_id))
        conn.commit()


def get_survey(user_id: int) -> dict | None:
    with closing(_connect()) as conn:
        row = conn.execute("SELECT survey FROM workout_plans WHERE user_id = ?", (user_id,)).fetchone()
    return json.loads(row[0]) if row else None
