from aiogram import Router
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
    WebAppInfo,
)

from config import WEBAPP_URL
from database.db import get_plan_param

router = Router()


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


def open_plan_keyboard(param: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="Открыть план", web_app=WebAppInfo(url=webapp_url(param))),
    ]])


@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    await message.answer(
        "Привет! Я составлю план тренировок на неделю и проведу по нему: "
        "у каждого упражнения есть клип, таймер и отдых между подходами.\n\n"
        "Нажми «📝 Составить план» внизу и ответь на пять вопросов.",
        reply_markup=survey_keyboard(),
    )


@router.message(Command("myplan"))
async def cmd_myplan(message: Message) -> None:
    param = get_plan_param(message.from_user.id)
    if not param:
        await message.answer("Плана пока нет. Нажми «📝 Составить план» внизу.", reply_markup=survey_keyboard())
        return
    await message.answer("Твой последний план:", reply_markup=open_plan_keyboard(param))
