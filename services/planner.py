"""Проверка ответов опроса и упаковка их в ссылку на мини-апп.

Сам план составляет мини-апп (docs/planner.js) по правилам — бот передаёт только ответы.
"""
import base64
import json

GOALS = {"mass", "loss", "fit", "endurance"}
LEVELS = {1, 2, 3}
EQUIPMENT = {"none", "dumbbell", "gym"}
AVOID = {"knees", "back", "shoulders", "wrists"}
MUSCLES = {"chest", "lats", "delts", "biceps", "triceps", "abs", "legs", "glutes"}
WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]


class InvalidData(ValueError):
    pass


def validate_survey(data: dict) -> dict:
    """Ответы опроса из мини-аппа. remind=True — пользователь хочет напоминания."""
    try:
        wd = sorted({int(d) for d in data.get("wd") or [] if 0 <= int(d) <= 6})
        survey = {
            "goal": str(data["goal"]),
            "level": int(data["level"]),
            "eq": str(data["eq"]),
            "wd": wd,
            "days": len(wd),
            "avoid": [a for a in data.get("avoid") or [] if a in AVOID],
            "focus": [m for m in data.get("focus") or [] if m in MUSCLES],
            "kg": max(35, min(200, int(data.get("kg") or 70))),
        }
    except (KeyError, TypeError, ValueError) as e:
        raise InvalidData("bad survey") from e
    if (survey["goal"] not in GOALS or survey["level"] not in LEVELS
            or survey["eq"] not in EQUIPMENT or not 2 <= survey["days"] <= 6):
        raise InvalidData("bad survey")
    survey["remind"] = bool(data.get("remind"))
    return survey


def plan_survey(survey: dict) -> dict:
    """Ответы, нужные мини-аппу для плана (без флага напоминаний)."""
    return {k: v for k, v in survey.items() if k != "remind"}


def encode(obj: dict) -> str:
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def plan_url_param(survey: dict) -> str:
    return "s=" + encode(plan_survey(survey))


def days_text(days: list[int]) -> str:
    return ", ".join(WEEKDAYS[d] for d in sorted(days))
