import json

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from database.db import save_plan
from handlers.keyboards import open_plan_keyboard
from handlers.reminders import ask_time
from services.planner import InvalidData, days_text, plan_survey, plan_url_param, validate_survey

router = Router()


@router.message(F.web_app_data)
async def on_survey(message: Message, state: FSMContext) -> None:
    """Ответы опроса из мини-аппа → ссылка на план (сам план собирает мини-апп)."""
    try:
        survey = validate_survey(json.loads(message.web_app_data.data))
    except (InvalidData, json.JSONDecodeError):
        await message.answer("Не смог прочитать ответы. Попробуй пройти опрос ещё раз.")
        return

    param = plan_url_param(survey)
    save_plan(message.from_user.id, plan_survey(survey), param, "rules")
    await message.answer(
        f"Готово! План на {survey['days']} дн. в неделю: {days_text(survey['wd'])}.\n"
        "Открой план, выбери день и жми «Начать тренировку».",
        reply_markup=open_plan_keyboard(param),
    )
    if survey["remind"]:
        await ask_time(message, state, survey["wd"])
