import re

from aiogram import F, Router
from aiogram.filters import Command, CommandObject
from aiogram.types import CallbackQuery, Message

from database.db import get_reminder, get_survey, set_reminder
from handlers.keyboards import REMIND_TIMES, reminder_keyboard, reminder_text

router = Router()
TIME_RE = re.compile(r"([01]?\d|2[0-3])[:.]([0-5]\d)")


def _current(user_id: int) -> dict:
    rem = get_reminder(user_id)
    if rem:
        return rem
    survey = get_survey(user_id) or {}
    return {"days": survey.get("wd") or [0, 2, 4], "time": "19:00", "enabled": False}


async def show_reminders(message: Message) -> None:
    r = _current(message.from_user.id)
    await message.answer(reminder_text(**r), reply_markup=reminder_keyboard(**r))


@router.message(Command("remind"))
async def cmd_remind(message: Message, command: CommandObject) -> None:
    if command.args:
        m = TIME_RE.fullmatch(command.args.strip())
        if not m:
            await message.answer("Не понял время. Пример: /remind 19:30")
            return
        r = _current(message.from_user.id)
        time = f"{int(m.group(1)):02d}:{m.group(2)}"
        set_reminder(message.from_user.id, r["days"], time, enabled=True)
    await show_reminders(message)


@router.callback_query(F.data.startswith("rm:"))
async def on_reminder_button(call: CallbackQuery) -> None:
    uid = call.from_user.id
    r = _current(uid)
    _, action, *rest = call.data.split(":", 2)
    value = rest[0] if rest else ""

    if action == "ok":
        await call.message.edit_reply_markup(reply_markup=None)
        await call.answer("Сохранено")
        return
    if action == "d" and value.isdigit() and 0 <= int(value) <= 6:
        d = int(value)
        r["days"] = [x for x in r["days"] if x != d] if d in r["days"] else r["days"] + [d]
        r["enabled"] = bool(r["days"])
    elif action == "t" and value in REMIND_TIMES:
        r["time"], r["enabled"] = value, True
    elif action in ("on", "off"):
        r["enabled"] = action == "on"
    else:
        await call.answer()
        return

    set_reminder(uid, r["days"], r["time"], r["enabled"])
    await call.message.edit_text(reminder_text(**r), reply_markup=reminder_keyboard(**r))
    await call.answer()
