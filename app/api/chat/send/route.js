import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { getSession } from '../../../../lib/auth';
import { sendToOwner } from '../../../../lib/telegram';

export async function POST(req) {
  const session = getSession();
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { message } = await req.json();
  if (!message || !message.trim()) return NextResponse.json({ success: false, error: 'Pesan kosong' }, { status: 400 });

  const { data: user } = await mongoAdmin.from('users').select('username').eq('id', session.id).maybeSingle();
  await mongoAdmin.from('chats').insert({ user_id: session.id, from_admin: false, message });

  await sendToOwner(`💬 *PESAN USER*\n👤 ${user?.username}\n💬 ${message}`, {
    reply_markup: { inline_keyboard: [[{ text: 'Balas', callback_data: `reply_${session.id}` }]] }
  });

  return NextResponse.json({ success: true });
}
