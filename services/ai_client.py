import asyncio

from google import genai
from google.genai import types

from config import GEMINI_API_KEY
from services.planner import AVOID, EQUIPMENT, GOALS, LEVELS, MUSCLES, allowed_exercises, parse_ai_plan

MODEL = "gemini-2.5-flash"
TIMEOUT_SECONDS = 45

_client = genai.Client(api_key=GEMINI_API_KEY)

CATEGORIES = {"legs": "ноги", "push": "жимы", "pull": "тяги", "core": "пресс", "cardio": "кардио"}

PROMPT = """\
Ты — фитнес-тренер. Составь недельный план тренировок, выбирая упражнения
ТОЛЬКО из списка ниже (используй ключи в квадратных скобках).

Пользователь:
- цель: {goal}
- уровень: {level}
- где тренируется: {eq}
- тренировочных дней в неделю: {days}
- беречь: {avoid}
- акцент на мышцы: {focus}

Доступные упражнения:
{exercises}

Правила:
1. Ровно {days} дней, в каждом 5–7 упражнений, без повторов внутри дня.
2. Сбалансируй дни по группам мышц, дай каждому дню короткое название (до 3 слов).
   Если указан акцент, в каждом дне должно быть хотя бы одно упражнение на эти мышцы.
3. sets — число подходов (2–5). amount — повторения для «повт» (5–25) или секунды для «сек» (15–90).
4. Подбирай объём под цель и уровень.

Ответь только JSON такого вида:
{{"days": [{{"title": "Верх тела", "items": [{{"key": "pu", "sets": 3, "amount": 12}}]}}]}}
"""


async def generate_plan(survey: dict) -> dict:
    exercises = "\n".join(
        f"[{e['k']}] {e['name']} — {CATEGORIES[e['cat']]}, мышцы: {', '.join(MUSCLES[m] for m in e['mus'])}, "
        f"{'сек' if e['mode'] == 'time' else 'повт'}"
        for e in allowed_exercises(survey)
    )
    prompt = PROMPT.format(
        goal=GOALS[survey["goal"]],
        level=LEVELS[survey["level"]],
        eq=EQUIPMENT[survey["eq"]],
        days=survey["days"],
        avoid=", ".join(AVOID[a] for a in survey["avoid"]) or "ничего",
        focus=", ".join(MUSCLES[m] for m in survey["focus"]) or "всё тело равномерно",
        exercises=exercises,
    )
    response = await asyncio.wait_for(
        _client.aio.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.7),
        ),
        timeout=TIMEOUT_SECONDS,
    )
    return parse_ai_plan(response.text, survey)
