import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { tgSend, tgEditMessage, tgAnswerCallback } from '../../../../lib/telegram';

const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;
function formatRupiah(n) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n || 0); }

async function findUser(identifier) {
  if (!isNaN(identifier)) { const { data } = await mongoAdmin.from('users').select('*').eq('id', identifier).maybeSingle(); if (data) return data; }
  const { data } = await mongoAdmin.from('users').select('*').ilike('username', identifier).maybeSingle();
  return data;
}

// Telegram akan POST ke sini setiap ada update (message/callback).
// Setelah deploy, daftarkan webhook sekali via:
// curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<domain>/api/telegram/webhook&secret_token=<WEBHOOK_SECRET>"
export async function POST(req) {
  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = await req.json();

  if (update.callback_query) {
    const cb = update.callback_query;
    const data = cb.data, chatId = cb.message.chat.id, messageId = cb.message.message_id;
    try {
      if (data.startsWith('process_wd_')) {
        const wdId = data.replace('process_wd_', '');
        const { data: rows } = await mongoAdmin.from('withdrawals').update({ status: 'success', processed_at: new Date().toISOString() }).eq('id', wdId).eq('status', 'pending').select();
        if (!rows?.length) { await tgAnswerCallback(cb.id, { text: '⚠️ Sudah diproses atau tidak ditemukan!', show_alert: true }); }
        else { await tgEditMessage(chatId, messageId, `✅ *WD ${wdId} DIPROSES*\nStatus: SUCCESS`); await tgAnswerCallback(cb.id, { text: '✅ WD berhasil diproses!' }); }
      } else if (data.startsWith('fail_wd_')) {
        const wdId = data.replace('fail_wd_', '');
        const { data: rows } = await mongoAdmin.from('withdrawals').update({ status: 'failed', failed_at: new Date().toISOString() }).eq('id', wdId).eq('status', 'pending').select();
        if (!rows?.length) { await tgAnswerCallback(cb.id, { text: '⚠️ Sudah diproses atau tidak ditemukan!', show_alert: true }); }
        else {
          await mongoAdmin.rpc('refund_balance_atomic', { p_user_id: rows[0].user_id, p_amount: rows[0].amount });
          await tgEditMessage(chatId, messageId, `❌ *WD ${wdId} GAGAL*\nSaldo dikembalikan ke user.`);
          await tgAnswerCallback(cb.id, { text: '❌ WD gagal, saldo dikembalikan!' });
        }
      } else if (data.startsWith('reply_')) {
        const userId = data.split('_')[1];
        // Ganti pola lama `bot.once('message', ...)` (butuh proses long-running, tidak ada di serverless).
        // Sekarang ID user disisipkan di teks prompt, lalu dibaca ulang dari reply_to_message di handler pesan bawah.
        await tgSend(chatId, `Balas untuk user ID ${userId}:`, { reply_markup: { force_reply: true } });
        await tgAnswerCallback(cb.id);
      }
    } catch (e) {
      console.error('Callback error:', e);
      await tgAnswerCallback(cb.id, { text: '❌ Terjadi kesalahan!', show_alert: true });
    }
    return NextResponse.json({ ok: true });
  }

  const msg = update.message;
  if (!msg || !msg.text) return NextResponse.json({ ok: true });
  const chatId = msg.chat.id, fromId = msg.from.id.toString(), text = msg.text.trim();
  const isOwner = fromId === ADMIN_ID;

  // Tangkap balasan admin ke prompt "Balas untuk user ID X:" (pengganti bot.once('message') lama)
  if (isOwner && msg.reply_to_message?.text?.startsWith('Balas untuk user ID ')) {
    const targetUserId = msg.reply_to_message.text.replace('Balas untuk user ID ', '').replace(':', '').trim();
    await mongoAdmin.from('chats').insert({ user_id: targetUserId, from_admin: true, message: text });
    await tgSend(chatId, '✅ Balasan terkirim.');
    return NextResponse.json({ ok: true });
  }

  const cmd = (re) => text.match(re);
  let m;

  if (isOwner && (m = cmd(/^\/addsaldo (\S+) (\d+)$/))) {
    const user = await findUser(m[1]);
    if (!user) return reply(chatId, `❌ User "${m[1]}" tidak ditemukan`);
    const { data } = await mongoAdmin.rpc('refund_balance_atomic', { p_user_id: user.id, p_amount: parseInt(m[2]) });
    await tgSend(chatId, `✅ *TAMBAH SALDO*\n👤 ${user.username}\n+${formatRupiah(m[2])}\n💵 Saldo Baru: ${formatRupiah(data[0].balance)}`);
    await mongoAdmin.from('chats').insert({ user_id: user.id, from_admin: true, message: `💰 Saldo Anda +${formatRupiah(m[2])}\nSaldo: ${formatRupiah(data[0].balance)}` });
  }
  else if (isOwner && (m = cmd(/^\/delsaldo (\S+) (\d+)$/))) {
    const user = await findUser(m[1]);
    if (!user) return reply(chatId, `❌ User "${m[1]}" tidak ditemukan`);
    const { data } = await mongoAdmin.rpc('deduct_balance_atomic', { p_user_id: user.id, p_amount: parseInt(m[2]) });
    if (!data?.length) return reply(chatId, `❌ Saldo tidak cukup! Saldo: ${formatRupiah(user.balance)}`);
    await tgSend(chatId, `✅ *KURANGI SALDO*\n👤 ${user.username}\n-${formatRupiah(m[2])}\n💵 Saldo Baru: ${formatRupiah(data[0].balance)}`);
  }
  else if (isOwner && (m = cmd(/^\/ceksaldo (\S+)$/))) {
    const user = await findUser(m[1]);
    if (!user) return reply(chatId, `❌ User tidak ditemukan`);
    await tgSend(chatId, `💰 *${user.username}*\nSaldo: ${formatRupiah(user.balance)}`);
  }
  else if (isOwner && cmd(/^\/ceksaldoall$/)) {
    const { data: users } = await mongoAdmin.from('users').select('username,balance').order('balance', { ascending: false });
    const total = users.reduce((s, u) => s + (u.balance || 0), 0);
    let list = ''; for (let i = 0; i < Math.min(20, users.length); i++) list += `\n${i + 1}. ${users[i].username} — ${formatRupiah(users[i].balance || 0)}`;
    await tgSend(chatId, `📊 *SEMUA USER*\n👥 ${users.length} user\n💰 Total: ${formatRupiah(total)}\n━━━━━━━━━━━━━━━━\n*Top 20:*${list || '\nTidak ada data'}`);
  }
  else if (isOwner && (m = cmd(/^\/suspend (\S+)$/))) {
    const user = await findUser(m[1]);
    if (!user) return reply(chatId, `❌ User "${m[1]}" tidak ditemukan`);
    if (user.suspended) return reply(chatId, `⚠️ User ${user.username} sudah di-suspend`);
    await mongoAdmin.from('users').update({ suspended: true, suspended_at: new Date().toISOString() }).eq('id', user.id);
    await tgSend(chatId, `🔒 *User ${user.username} berhasil di-SUSPEND*\nDeposit & login diblok.`);
  }
  else if (isOwner && (m = cmd(/^\/unsuspend (\S+)$/))) {
    const user = await findUser(m[1]);
    if (!user) return reply(chatId, `❌ User "${m[1]}" tidak ditemukan`);
    await mongoAdmin.from('users').update({ suspended: false, suspended_at: null }).eq('id', user.id);
    await tgSend(chatId, `🔓 *User ${user.username} berhasil di-UNSUSPEND*\nAkun aktif kembali.`);
  }
  else if (isOwner && (m = cmd(/^\/cekuser (\S+)$/))) {
    const user = await findUser(m[1]);
    if (!user) return reply(chatId, `❌ User "${m[1]}" tidak ditemukan`);
    const { count } = await mongoAdmin.from('deposits').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'pending').gt('expired_at', new Date().toISOString());
    await tgSend(chatId, `👤 *${user.username}*\n💰 Saldo: ${formatRupiah(user.balance)}\n📊 Status: ${user.suspended ? '🔒 SUSPENDED' : '✅ Aktif'}\n⏳ Pending deposit: ${count || 0}\n🆔 ID: ${user.id}`);
  }
  else if (isOwner && (m = cmd(/^\/cancelspam (\S+)$/))) {
    const user = await findUser(m[1]);
    if (!user) return reply(chatId, `❌ User "${m[1]}" tidak ditemukan`);
    const { data: rows } = await mongoAdmin.from('deposits').update({ status: 'canceled', canceled_at: new Date().toISOString() }).eq('user_id', user.id).eq('status', 'pending').select();
    await tgSend(chatId, `🗑 *${rows?.length || 0} deposit pending user ${user.username} dibatalkan.*`);
  }
  else if (cmd(/^\/help$/)) {
    let helpText = `🤖 *COMMAND BOT DIGITAL PEDIA*\n━━━━━━━━━━━━━━━━\n👑 *Command Owner:*\n/addsaldo <id/user> <jumlah>\n/delsaldo <id/user> <jumlah>\n/ceksaldo <id/user>\n/ceksaldoall\n━━━━━━━━━━━━━━━━\n🔒 *Security:*\n/suspend <username>\n/unsuspend <username>\n/cekuser <username>\n/cancelspam <username>\n📅 ${new Date().toLocaleString('id-ID')}`;
    if (isOwner) { const { count } = await mongoAdmin.from('users').select('*', { count: 'exact', head: true }); helpText += `\n\n🔐 Total User: ${count}`; }
    await tgSend(chatId, helpText);
  }

  return NextResponse.json({ ok: true });
}

async function reply(chatId, text) { await tgSend(chatId, text); return NextResponse.json({ ok: true }); }
