import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.types import BotCommand, MenuButtonWebApp, WebAppInfo

from config import BOT_TOKEN, WEBAPP_URL
from database.db import init_db
from handlers import reminders, start, webapp
from services.reminders import reminder_loop


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    init_db()

    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher()
    dp.include_router(start.router)
    dp.include_router(webapp.router)
    dp.include_router(reminders.router)

    # Кнопка «Мой план» слева от поля ввода: мини-апп сам покажет последний сохранённый план.
    await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Мой план", web_app=WebAppInfo(url=WEBAPP_URL)))
    await bot.set_my_commands([
        BotCommand(command="start", description="Начать и составить план"),
        BotCommand(command="myplan", description="Открыть последний план"),
        BotCommand(command="remind", description="Напоминания о тренировках"),
    ])

    await bot.delete_webhook(drop_pending_updates=True)
    reminders_task = asyncio.create_task(reminder_loop(bot))
    try:
        await dp.start_polling(bot)
    finally:
        reminders_task.cancel()


if __name__ == "__main__":
    asyncio.run(main())
