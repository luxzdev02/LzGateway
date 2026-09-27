import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { verifyAdminKey } from '../../../../lib/auth';

export async function GET(req) {
  if (!verifyAdminKey(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const userid = searchParams.get('userid');

  let user;
  if (userid && !isNaN(userid)) { const { data } = await mongoAdmin.from('users').select('*').eq('id', userid).maybeSingle(); user = data; }
  if (!user && userid) { const { data } = await mongoAdmin.from('users').select('*').ilike('username', userid).maybeSingle(); user = data; }
  if (!user) return NextResponse.json({ success: false, error: 'User tidak ditemukan' }, { status: 404 });

  return NextResponse.json({ success: true, data: { user_id: user.id, username: user.username, balance: user.balance, api_key: user.api_key } });
}
