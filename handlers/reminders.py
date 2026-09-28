import re

from aiogram import F, Router
from aiogram.filters import Command, CommandObject
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from database.db import get_reminder, get_survey, set_reminder
from handlers.keyboards import reminder_keyboard, reminder_text
from services.planner import days_text

router = Router()
TIME_RE = re.compile(r"\s*([01]?\d|2[0-3])\s*[:.\-\s]\s*([0-5]\d)\s*")
CANCEL = {"отмена", "нет", "не надо", "стоп"}


class ReminderSetup(StatesGroup):
    time = State()


def parse_time(text: str) -> str | None:
    m = TIME_RE.fullmatch(text or "")
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else None


def _current(user_id: int) -> dict:
    rem = get_reminder(user_id)
    if rem:
        return rem
    survey = get_survey(user_id) or {}
    return {"days": survey.get("wd") or [0, 2, 4], "time": None, "enabled": False}


async def ask_time(message: Message, state: FSMContext, days: list[int]) -> None:
    await state.set_state(ReminderSetup.time)
    await state.update_data(days=days)
    await message.answer(
        f"🔔 Во сколько напоминать о тренировке ({days_text(days)})?\n"
        "Напиши время, например 07:30 или 19:00. Передумал — напиши «отмена»."
    )


async def show_reminders(message: Message, state: FSMContext) -> None:
    r = _current(message.from_user.id)
    await message.answer(reminder_text(**r), reply_markup=reminder_keyboard(r["days"], r["enabled"]))
    await state.set_state(ReminderSetup.time)
    await state.update_data(days=r["days"])


@router.message(Command("remind"))
async def cmd_remind(message: Message, command: CommandObject, state: FSMContext) -> None:
    time = parse_time(command.args or "")
    if time:
        r = _current(message.from_user.id)
        set_reminder(message.from_user.id, r["days"], time, enabled=True)
    await show_reminders(message, state)


@router.message(ReminderSetup.time, F.text)
async def on_time(message: Message, state: FSMContext) -> None:
    if message.text.strip().lower() in CANCEL:
        await state.clear()
        await message.answer("Хорошо, без напоминаний. Включить можно командой /remind")
        return
    time = parse_time(message.text)
    if not time:
        await message.answer("Не понял время 🤔 Напиши, например, 19:30. Или «отмена».")
        return
    days = (await state.get_data()).get("days") or _current(message.from_user.id)["days"]
    set_reminder(message.from_user.id, days, time, enabled=True)
    await state.clear()
    await message.answer(f"Готово! Напомню: {days_text(days)} в {time}.\nИзменить — /remind")


@router.callback_query(F.data.startswith("rm:"))
async def on_reminder_button(call: CallbackQuery, state: FSMContext) -> None:
    uid = call.from_user.id
    r = _current(uid)
    _, action, *rest = call.data.split(":", 2)
    value = rest[0] if rest else ""

    if action == "ok":
        await call.message.edit_reply_markup(reply_markup=None)
        await state.clear()
        await call.answer("Сохранено")
        return
    if action == "d" and value.isdigit() and 0 <= int(value) <= 6:
        d = int(value)
        r["days"] = [x for x in r["days"] if x != d] if d in r["days"] else r["days"] + [d]
    elif action in ("on", "off"):
        r["enabled"] = action == "on"
    else:
        await call.answer()
        return

    await state.update_data(days=r["days"])
    if r["time"]:
        set_reminder(uid, r["days"], r["time"], r["enabled"] and bool(r["days"]))
        r["enabled"] = r["enabled"] and bool(r["days"])
    elif action == "on":
        await call.answer("Сначала напиши время, например 19:30", show_alert=True)
        return
    await call.message.edit_text(reminder_text(**r), reply_markup=reminder_keyboard(r["days"], r["enabled"]))
    await call.answer()
