"""Фоновая отправка напоминаний. Время — по часам компьютера, на котором запущен бот."""
import asyncio
import logging
from datetime import datetime

from aiogram import Bot
from aiogram.exceptions import TelegramForbiddenError

from database.db import due_reminders, get_plan_param, get_reminder, mark_reminded, set_reminder
from handlers.keyboards import open_plan_keyboard

log = logging.getLogger(__name__)
CHECK_EVERY_SECONDS = 20


async def reminder_loop(bot: Bot) -> None:
    while True:
        try:
            await send_due(bot, datetime.now())
        except Exception:
            log.exception("Ошибка при отправке напоминаний")
        await asyncio.sleep(CHECK_EVERY_SECONDS)


async def send_due(bot: Bot, now: datetime) -> int:
    today = now.date().isoformat()
    sent = 0
    for uid in due_reminders(now.weekday(), now.strftime("%H:%M"), today):
        mark_reminded(uid, today)  # отмечаем заранее, чтобы при ошибке не слать каждые 20 секунд
        try:
            await bot.send_message(
                uid,
                "Пора на тренировку 💪\nОткрой план — сегодняшний день уже ждёт.",
                reply_markup=open_plan_keyboard(get_plan_param(uid)),
            )
            sent += 1
        except TelegramForbiddenError:
            # Пользователь заблокировал бота — выключаем напоминания
            r = get_reminder(uid)
            if r:
                set_reminder(uid, r["days"], r["time"], enabled=False)
    return sent
