import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../../lib/mongodb';
import { getSession } from '../../../../../lib/auth';

// FIX KEAMANAN: versi lama tanpa auth — siapa pun bisa baca isi chat user lain.
export async function GET(req, { params }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (String(session.id) !== String(params.user_id)) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const { data } = await mongoAdmin.from('chats').select('*').eq('user_id', params.user_id).order('created_at', { ascending: true });
  return NextResponse.json((data || []).map(c => ({ ...c, from_owner: c.from_admin, timestamp: c.created_at })));
}
