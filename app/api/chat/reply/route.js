import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { verifyAdminKey } from '../../../../lib/auth';

export async function POST(req) {
  if (!verifyAdminKey(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { user_id, message } = await req.json();
  if (!user_id || !message) return NextResponse.json({ success: false, error: 'user_id & message required' }, { status: 400 });

  await mongoAdmin.from('chats').insert({ user_id, from_admin: true, message });
  return NextResponse.json({ success: true });
}
