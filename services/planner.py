"""Библиотека упражнений, проверка ответов опроса и плана от ИИ, упаковка плана в ссылку.

Та же логика фильтрации есть в docs/planner.js — правила должны совпадать.
"""
import base64
import json
import re
from pathlib import Path

LIBRARY_PATH = Path(__file__).resolve().parent.parent / "docs" / "exercises.json"
LIBRARY: list[dict] = json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))
BY_KEY = {e["k"]: e for e in LIBRARY}

GOALS = {"mass": "Набор массы", "loss": "Похудение", "fit": "Поддержание формы", "endurance": "Выносливость"}
LEVELS = {1: "Новичок", 2: "Средний", 3: "Продвинутый"}
EQUIPMENT = {"none": "дома без инвентаря", "dumbbell": "дома с гантелями", "gym": "в тренажёрном зале"}
AVOID = {"knees": "колени", "back": "спина", "shoulders": "плечи", "wrists": "запястья"}
MUSCLES = {"chest": "грудь", "lats": "спина", "delts": "плечи", "biceps": "бицепс",
           "triceps": "трицепс", "abs": "пресс", "legs": "ноги", "glutes": "ягодицы"}
WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
EQ_RANK = {"none": 0, "dumbbell": 1, "gym": 2}
MAX_URL_PARAM = 1800  # запас до лимитов длины ссылки в кнопке


class InvalidData(ValueError):
    pass


def validate_survey(data: dict) -> dict:
    """Ответы опроса из мини-аппа. remind — время напоминания «ЧЧ:ММ» или None."""
    try:
        wd = sorted({int(d) for d in data.get("wd") or [] if 0 <= int(d) <= 6})
        survey = {
            "goal": str(data["goal"]),
            "level": int(data["level"]),
            "eq": str(data["eq"]),
            "days": len(wd) if wd else int(data["days"]),
            "avoid": [a for a in data.get("avoid") or [] if a in AVOID],
            "focus": [m for m in data.get("focus") or [] if m in MUSCLES],
        }
    except (KeyError, TypeError, ValueError) as e:
        raise InvalidData("bad survey") from e
    if wd:
        survey["wd"] = wd
    if (survey["goal"] not in GOALS or survey["level"] not in LEVELS
            or survey["eq"] not in EQUIPMENT or not 2 <= survey["days"] <= 6):
        raise InvalidData("bad survey")
    remind = data.get("remind")
    if remind is not None and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(remind)):
        raise InvalidData("bad remind time")
    survey["remind"] = remind
    return survey


def plan_survey(survey: dict) -> dict:
    """То, что нужно мини-аппу для следующих недель (без времени напоминания)."""
    return {k: v for k, v in survey.items() if k != "remind"}


def allowed_exercises(survey: dict) -> list[dict]:
    return [
        e for e in LIBRARY
        if EQ_RANK[e["eq"]] <= EQ_RANK[survey["eq"]]
        and e["lvl"] <= survey["level"]
        and not set(e["avoid"]) & set(survey["avoid"])
    ]


def _clamp(value, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, round(float(value))))
    except (TypeError, ValueError):
        return lo


def parse_ai_plan(raw: str, survey: dict) -> dict:
    """Превращает JSON-ответ ИИ в план. Всё сомнительное отбрасывается."""
    try:
        data = json.loads(raw)
        days_in = data["days"]
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        raise InvalidData("ИИ вернул не тот формат") from e
    allowed = {e["k"] for e in allowed_exercises(survey)}
    days = []
    for i, day in enumerate(days_in[: survey["days"]]):
        items, seen = [], set()
        for it in day.get("items", []):
            key = it.get("key") if isinstance(it, dict) else None
            if key not in allowed or key in seen:
                continue
            seen.add(key)
            ex = BY_KEY[key]
            amount = _clamp(it.get("amount"), 15, 90) if ex["mode"] == "time" else _clamp(it.get("amount"), 5, 25)
            items.append([key, _clamp(it.get("sets"), 2, 5), amount])
        if len(items) < 3:
            raise InvalidData(f"В дне {i + 1} мало подходящих упражнений")
        title = str(day.get("title") or f"День {i + 1}").strip()[:40]
        days.append({"t": title, "x": items[:8]})
    if len(days) != survey["days"]:
        raise InvalidData("ИИ вернул не то число дней")
    return {"v": 1, "g": survey["goal"], "w": 1, "s": plan_survey(survey), "d": days, "src": "ai"}


def encode(obj: dict) -> str:
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def plan_url_param(plan: dict | None, survey: dict) -> str:
    """p=<план от ИИ>, а если его нет или он слишком длинный — s=<ответы>, и план соберёт мини-апп."""
    if plan:
        param = encode(plan)
        if len(param) > MAX_URL_PARAM:
            plan = {**plan, "d": [{"t": "", "x": d["x"]} for d in plan["d"]]}
            param = encode(plan)
        if len(param) <= MAX_URL_PARAM:
            return "p=" + param
    return "s=" + encode(plan_survey(survey))
