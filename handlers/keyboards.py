from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    WebAppInfo,
)

from config import WEBAPP_URL

WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
REMIND_TIMES = ["07:00", "08:00", "09:00", "12:00", "18:00", "19:00", "20:00", "21:00"]


def webapp_url(param: str = "") -> str:
    if not param:
        return WEBAPP_URL
    return WEBAPP_URL + ("&" if "?" in WEBAPP_URL else "?") + param


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


def reminder_keyboard(days: list[int], time: str, enabled: bool) -> InlineKeyboardMarkup:
    day_row = [
        InlineKeyboardButton(text=("✓ " if d in days else "") + name, callback_data=f"rm:d:{d}")
        for d, name in enumerate(WEEKDAYS)
    ]
    times = [
        InlineKeyboardButton(text=("• " + t + " •") if t == time else t, callback_data=f"rm:t:{t}")
        for t in REMIND_TIMES
    ]
    return InlineKeyboardMarkup(inline_keyboard=[
        day_row[:4], day_row[4:], times[:4], times[4:],
        [
            InlineKeyboardButton(text="🔕 Выключить" if enabled else "🔔 Включить", callback_data="rm:off" if enabled else "rm:on"),
            InlineKeyboardButton(text="Готово", callback_data="rm:ok"),
        ],
    ])


def reminder_text(days: list[int], time: str, enabled: bool) -> str:
    if enabled and days:
        status = f"🔔 Напомню о тренировке: {', '.join(WEEKDAYS[d] for d in sorted(days))} в {time}"
    else:
        status = "🔕 Напоминания выключены"
    return f"{status}\n\nВыбери дни и время кнопками. Своё время: /remind 19:30"
