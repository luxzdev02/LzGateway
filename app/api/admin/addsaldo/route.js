import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { verifyAdminKey } from '../../../../lib/auth';
import { sendToOwner } from '../../../../lib/telegram';

async function findUserByIdOrUsername(identifier) {
  if (!isNaN(identifier)) {
    const { data } = await mongoAdmin.from('users').select('*').eq('id', identifier).maybeSingle();
    if (data) return data;
  }
  const { data } = await mongoAdmin.from('users').select('*').ilike('username', identifier).maybeSingle();
  return data;
}

async function handle(req, userid, nominal) {
  if (!userid || !nominal) return NextResponse.json({ success: false, error: 'userid dan nominal required' }, { status: 400 });
  const amount = parseInt(nominal);
  if (isNaN(amount) || amount <= 0) return NextResponse.json({ success: false, error: 'nominal harus angka positif' }, { status: 400 });

  const user = await findUserByIdOrUsername(userid);
  if (!user) return NextResponse.json({ success: false, error: `User "${userid}" tidak ditemukan` }, { status: 404 });

  const { data: updated } = await mongoAdmin.rpc('refund_balance_atomic', { p_user_id: user.id, p_amount: amount }); // reuse: balance + amount
  const newBalance = updated?.[0]?.balance ?? (user.balance + amount);

  await mongoAdmin.from('admin_logs').insert({ action: 'addsaldo', target_user_id: user.id, target_username: user.username, amount, old_balance: user.balance, new_balance: newBalance });
  await sendToOwner(`💰 Admin +${amount} → ${user.username}`);

  return NextResponse.json({ success: true, data: { username: user.username, old_balance: user.balance, added_amount: amount, new_balance: newBalance } });
}

export async function GET(req) {
  if (!verifyAdminKey(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  return handle(req, searchParams.get('userid'), searchParams.get('nominal'));
}
export async function POST(req) {
  if (!verifyAdminKey(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  return handle(req, body.userid, body.nominal);
}
