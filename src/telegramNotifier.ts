const TELEGRAM_API_URL = 'https://api.telegram.org';
import { getAppSetting } from './settings';

export function isTelegramConfigured(): boolean {
  return Boolean(getAppSetting('TELEGRAM_BOT_TOKEN') && getAppSetting('TELEGRAM_CHAT_ID'));
}

export async function notifyTelegram(message: string): Promise<void> {
  if (!isTelegramConfigured()) return;

  const token = getAppSetting('TELEGRAM_BOT_TOKEN');
  const chatId = getAppSetting('TELEGRAM_CHAT_ID');
  try {
    const response = await fetch(`${TELEGRAM_API_URL}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) console.warn(`Telegram notification failed: HTTP ${response.status}`);
  } catch (error) {
    console.warn(`Telegram notification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
