import json
import logging

from aiogram import F, Router
from aiogram.types import Message

from database.db import save_plan, set_reminder
from handlers.keyboards import WEEKDAYS, open_plan_keyboard
from services.ai_client import generate_plan
from services.planner import InvalidData, plan_survey, plan_url_param, validate_survey

router = Router()
log = logging.getLogger(__name__)


@router.message(F.web_app_data)
async def on_survey(message: Message) -> None:
    """Ответы опроса из мини-аппа → план от ИИ (или по правилам, если ИИ не справился)."""
    try:
        survey = validate_survey(json.loads(message.web_app_data.data))
    except (InvalidData, json.JSONDecodeError):
        await message.answer("Не смог прочитать ответы. Попробуй пройти опрос ещё раз.")
        return

    wait = await message.answer("Подбираю упражнения… ⏳")
    plan = None
    try:
        plan = await generate_plan(survey)
    except Exception:
        log.exception("ИИ не смог составить план, соберу по правилам")

    param = plan_url_param(plan, survey)
    source = "ai" if param.startswith("p=") else "rules"
    save_plan(message.from_user.id, plan_survey(survey), param, source)

    if source == "ai":
        days = "\n".join(f"День {i + 1} — {d['t']}" for i, d in enumerate(plan["d"]) if d["t"])
        text = f"Готово! План на {len(plan['d'])} дн. в неделю:\n{days}"
    else:
        text = ("Готово! ИИ сейчас не ответил, поэтому план собран по правилам: "
                "он учитывает цель, уровень, инвентарь и ограничения.")
    if survey["remind"] and survey.get("wd"):
        set_reminder(message.from_user.id, survey["wd"], survey["remind"])
        days = ", ".join(WEEKDAYS[d] for d in survey["wd"])
        text += f"\n\n🔔 Напомню о тренировке: {days} в {survey['remind']}. Изменить — /remind"
    await wait.delete()
    await message.answer(text + "\n\nОткрой план, выбери день и жми «Начать тренировку».",
                         reply_markup=open_plan_keyboard(param))
