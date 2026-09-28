from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    WebAppInfo,
)

from config import WEBAPP_URL

# Увеличивай при каждом обновлении мини-аппа (и в docs/index.html тоже):
# Telegram кэширует страницу, а новый адрес заставляет его скачать свежую версию.
APP_VERSION = "3"

WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]


def webapp_url(param: str = "") -> str:
    query = f"v={APP_VERSION}" + (f"&{param}" if param else "")
    return WEBAPP_URL + ("&" if "?" in WEBAPP_URL else "?") + query


def survey_keyboard() -> ReplyKeyboardMarkup:
    # Опрос открывается именно с этой кнопки: только так мини-апп может вернуть ответы боту (sendData).
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text="📝 Составить план", web_app=WebAppInfo(url=webapp_url()))]],
        resize_keyboard=True,
        is_persistent=True,
    )


def open_plan_keyboard(param: str | None) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="Открыть план", web_app=WebAppInfo(url=webapp_url(param or ""))),
    ]])


def reminder_keyboard(days: list[int], enabled: bool) -> InlineKeyboardMarkup:
    day_row = [
        InlineKeyboardButton(text=("✓ " if d in days else "") + name, callback_data=f"rm:d:{d}")
        for d, name in enumerate(WEEKDAYS)
    ]
    return InlineKeyboardMarkup(inline_keyboard=[
        day_row[:4], day_row[4:],
        [
            InlineKeyboardButton(text="🔕 Выключить" if enabled else "🔔 Включить", callback_data="rm:off" if enabled else "rm:on"),
            InlineKeyboardButton(text="Готово", callback_data="rm:ok"),
        ],
    ])


def reminder_text(days: list[int], time: str | None, enabled: bool) -> str:
    if enabled and days and time:
        status = f"🔔 Напомню о тренировке: {', '.join(WEEKDAYS[d] for d in sorted(days))} в {time}"
    elif not time:
        status = "🔕 Время напоминаний ещё не задано"
    else:
        status = "🔕 Напоминания выключены"
    return f"{status}\n\nДни выбери кнопками. Чтобы поменять время, просто напиши его сюда, например 19:30"
