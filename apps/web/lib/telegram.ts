export const TELEGRAM_BOT_USERNAME =
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "cuustos_bot";

export function getTelegramBotUrl(startParam?: string): string {
  if (startParam) {
    return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${startParam}`;
  }
  return `https://t.me/${TELEGRAM_BOT_USERNAME}`;
}

export const telegramBotUrl = getTelegramBotUrl();
