import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { getSession } from '../../../../lib/auth';

// FIX KEAMANAN: versi lama endpoint ini publik tanpa auth sama sekali —
// siapa pun yang tahu/tebak sebuah user id bisa lihat balance & apiKey user lain.
// Sekarang wajib session, dan hanya boleh lihat data diri sendiri.
export async function GET(req, { params }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (String(session.id) !== String(params.id)) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const { data: user } = await mongoAdmin.from('users').select('id,username,balance,api_key').eq('id', params.id).maybeSingle();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  return NextResponse.json({ id: user.id, username: user.username, balance: user.balance, apiKey: user.api_key });
}
