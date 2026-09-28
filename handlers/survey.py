import logging

from aiogram import Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message, ReplyKeyboardMarkup, KeyboardButton, ReplyKeyboardRemove

from database.db import save_plan
from handlers.utils import send_long
from services.ai_client import generate_workout_plan

router = Router()


class WorkoutSurvey(StatesGroup):
    goal = State()
    level = State()
    equipment = State()
    days_per_week = State()
    restrictions = State()


def _kb(*options: str) -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text=o)] for o in options],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


@router.message(Command("plan"))
async def cmd_plan(message: Message, state: FSMContext) -> None:
    await state.set_state(WorkoutSurvey.goal)
    await message.answer(
        "Какая у тебя цель?",
        reply_markup=_kb("Набор массы", "Похудение", "Поддержание формы", "Выносливость"),
    )


@router.message(WorkoutSurvey.goal)
async def process_goal(message: Message, state: FSMContext) -> None:
    await state.update_data(goal=message.text)
    await state.set_state(WorkoutSurvey.level)
    await message.answer(
        "Какой у тебя уровень подготовки?",
        reply_markup=_kb("Новичок", "Средний", "Продвинутый"),
    )


@router.message(WorkoutSurvey.level)
async def process_level(message: Message, state: FSMContext) -> None:
    await state.update_data(level=message.text)
    await state.set_state(WorkoutSurvey.equipment)
    await message.answer(
        "Где и с каким оборудованием будешь заниматься?",
        reply_markup=_kb("Тренажёрный зал", "Дома с гантелями", "Дома без инвентаря"),
    )


@router.message(WorkoutSurvey.equipment)
async def process_equipment(message: Message, state: FSMContext) -> None:
    await state.update_data(equipment=message.text)
    await state.set_state(WorkoutSurvey.days_per_week)
    await message.answer(
        "Сколько дней в неделю готов тренироваться?",
        reply_markup=_kb("2", "3", "4", "5"),
    )


@router.message(WorkoutSurvey.days_per_week)
async def process_days(message: Message, state: FSMContext) -> None:
    if not (message.text or "").isdigit() or not 1 <= int(message.text) <= 7:
        await message.answer("Введи число от 1 до 7, например: 3")
        return
    await state.update_data(days_per_week=int(message.text))
    await state.set_state(WorkoutSurvey.restrictions)
    await message.answer(
        "Есть травмы или ограничения, которые нужно учесть? "
        "Если нет — напиши «нет».",
        reply_markup=ReplyKeyboardRemove(),
    )


@router.message(WorkoutSurvey.restrictions)
async def process_restrictions(message: Message, state: FSMContext) -> None:
    data = await state.update_data(restrictions=message.text)
    await state.clear()

    await message.answer("Генерирую план тренировок, подожди немного... 🏋️")

    try:
        plan_text = await generate_workout_plan(
            goal=data["goal"],
            level=data["level"],
            equipment=data["equipment"],
            days_per_week=data["days_per_week"],
            restrictions=data["restrictions"],
        )
    except Exception:
        logging.exception("Ошибка генерации плана")
        await message.answer("Не получилось сгенерировать план 😔 Попробуй ещё раз: /plan")
        return

    save_plan(
        user_id=message.from_user.id,
        goal=data["goal"],
        level=data["level"],
        equipment=data["equipment"],
        days_per_week=data["days_per_week"],
        restrictions=data["restrictions"],
        plan_text=plan_text,
    )

    await send_long(message, plan_text)
    await message.answer("План сохранён. Посмотреть его снова можно командой /myplan")
