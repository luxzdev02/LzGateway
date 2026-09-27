import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { verifyAdminKey } from '../../../../lib/auth';

export async function GET(req) {
  if (!verifyAdminKey(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search');

  let q = mongoAdmin.from('users').select('id,username,balance,created_at').order('balance', { ascending: false });
  if (search) q = q.or(`username.ilike.%${search}%,id.eq.${isNaN(search) ? -1 : search}`);
  const { data: users } = await q;

  return NextResponse.json({
    success: true,
    summary: { total_users: users.length, total_balance: users.reduce((s, u) => s + (u.balance || 0), 0) },
    data: users
  });
}
