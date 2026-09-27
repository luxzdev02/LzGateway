import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { verifyAdminKey } from '../../../../lib/auth';

export async function GET(req) {
  if (!verifyAdminKey(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const userid = searchParams.get('userid'), nominal = searchParams.get('nominal');
  if (!userid || !nominal) return NextResponse.json({ success: false, error: 'userid dan nominal required' }, { status: 400 });
  const amount = parseInt(nominal);

  let user;
  if (!isNaN(userid)) { const { data } = await mongoAdmin.from('users').select('*').eq('id', userid).maybeSingle(); user = data; }
  if (!user) { const { data } = await mongoAdmin.from('users').select('*').ilike('username', userid).maybeSingle(); user = data; }
  if (!user) return NextResponse.json({ success: false, error: 'User tidak ditemukan' }, { status: 404 });

  // Atomic + anti-negatif (deduct_balance_atomic hanya sukses jika balance cukup)
  const { data: result, error: deductErr } = await mongoAdmin.rpc('deduct_balance_atomic', { p_user_id: user.id, p_amount: amount });
  if (deductErr) return NextResponse.json({ success: false, error: `Gagal memproses saldo: ${deductErr.message}` }, { status: 500 });
  if (!result || result.length === 0) {
    return NextResponse.json({ success: false, error: `Saldo tidak cukup. Saldo: ${user.balance}` }, { status: 400 });
  }
  await mongoAdmin.from('admin_logs').insert({ action: 'delsaldo', target_user_id: user.id, target_username: user.username, amount, old_balance: user.balance, new_balance: result[0].balance });

  return NextResponse.json({ success: true, data: { username: user.username, old_balance: user.balance, deducted_amount: amount, new_balance: result[0].balance } });
}
