import os

from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
WEBAPP_URL = os.getenv("WEBAPP_URL", "").strip()

if not BOT_TOKEN:
    raise RuntimeError("Не найден BOT_TOKEN. Скопируй .env.example в .env и заполни значения.")
if not GEMINI_API_KEY:
    raise RuntimeError("Не найден GEMINI_API_KEY. Получить бесплатно: https://aistudio.google.com/app/apikey")
if not WEBAPP_URL.startswith("https://"):
    raise RuntimeError(
        "Не найден WEBAPP_URL (адрес мини-аппа на https, например https://ИМЯ.github.io/workout_bot/). "
        "Как опубликовать — в README."
    )

DB_PATH = os.getenv("DB_PATH", "workout_bot.db")
