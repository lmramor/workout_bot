from aiogram import Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import Message

from database.db import get_plan_param
from handlers.keyboards import open_plan_keyboard, survey_keyboard
from handlers.reminders import show_reminders

router = Router()


@router.message(CommandStart())
async def cmd_start(message: Message, command: CommandObject) -> None:
    # t.me/бот?start=remind — так мини-апп открывает настройки напоминаний
    if command.args == "remind":
        await show_reminders(message)
        return
    await message.answer(
        "Привет! Я составлю план тренировок и проведу по нему: "
        "у каждого упражнения есть клип, таймер и отдых между подходами.\n\n"
        "Нажми «📝 Составить план» внизу и ответь на несколько вопросов.",
        reply_markup=survey_keyboard(),
    )


@router.message(Command("myplan"))
async def cmd_myplan(message: Message) -> None:
    param = get_plan_param(message.from_user.id)
    if not param:
        await message.answer("Плана пока нет. Нажми «📝 Составить план» внизу.", reply_markup=survey_keyboard())
        return
    await message.answer("Твой план:", reply_markup=open_plan_keyboard(param))
