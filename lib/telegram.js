// PENTING: node-telegram-bot-api dengan { polling: true } TIDAK BISA jalan di Vercel
// (serverless function tidak punya proses long-running). Diganti total dengan webhook:
// Telegram kirim POST ke /api/telegram/webhook, dan kita balas via fetch ke Bot API biasa.

const BOT_TOKEN = process.env.BOT_TOKEN;
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

export async function tgSend(chatId, text, extra = {}) {
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra })
    });
  } catch (e) { console.error('tgSend error:', e.message); }
}

export async function tgSendPhoto(chatId, photo, caption, extra = {}) {
  try {
    await fetch(`${TG_API}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo, caption, parse_mode: 'Markdown', ...extra })
    });
  } catch (e) { console.error('tgSendPhoto error:', e.message); }
}

export async function tgAnswerCallback(callbackId, opts = {}) {
  try {
    await fetch(`${TG_API}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId, ...opts })
    });
  } catch (e) {}
}

export async function tgEditMessage(chatId, messageId, text, extra = {}) {
  try {
    await fetch(`${TG_API}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown', ...extra })
    });
  } catch (e) {}
}

export async function sendToOwner(text, extra = {}) {
  return tgSend(process.env.ADMIN_TELEGRAM_ID, text, extra);
}

export async function sendDepositSuccessNotification(deposit, user, formatRupiah) {
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  if (!channelId) return;
  const waktu = new Date().toLocaleString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const caption = `╔══════════════════════════╗\n║  💰 DEPOSIT BERHASIL 💰   ║\n╠══════════════════════════╣\n║  👤 ${user.username}\n║  💵 ${formatRupiah(deposit.amount)}\n║  💳 Total: ${formatRupiah(deposit.total_bayar)}\n║  💰 Saldo: ${formatRupiah(user.balance)}\n║  📅 ${waktu}\n╚══════════════════════════╝`;
  await tgSendPhoto(channelId, '', caption, {
    reply_markup: { inline_keyboard: [[{ text: '💳 PAYMENT GATEWAY', url: process.env.WEBSITE_URL }]] }
  });
}

export async function sendWithdrawNotification(withdraw, user, formatRupiah) {
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  if (!channelId) return;
  const waktu = new Date().toLocaleString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const tipe = withdraw.type === 'instant' ? '⚡ INSTAN' : '📋 MANUAL';
  const caption = `╔══════════════════════════╗\n║  💸 WITHDRAW ${tipe} 💸  ║\n╠══════════════════════════╣\n║  👤 ${user.username}\n║  💸 ${formatRupiah(withdraw.amount)}\n║  🏦 ${(withdraw.operator || '').toUpperCase()}\n║  💰 Saldo: ${formatRupiah(user.balance)}\n║  📅 ${waktu}\n╚══════════════════════════╝`;
  await tgSendPhoto(channelId, '', caption, {
    reply_markup: { inline_keyboard: [[{ text: '💳 PAYMENT GATEWAY', url: process.env.WEBSITE_URL }]] }
  });
}
