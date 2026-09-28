from aiogram.types import Message

TG_LIMIT = 4000


async def send_long(message: Message, text: str) -> None:
    """Отправляет текст несколькими сообщениями, если он длиннее лимита Telegram."""
    while text:
        if len(text) <= TG_LIMIT:
            await message.answer(text)
            return
        cut = text.rfind("\n", 0, TG_LIMIT)
        if cut <= 0:
            cut = TG_LIMIT
        await message.answer(text[:cut])
        text = text[cut:].lstrip("\n")
