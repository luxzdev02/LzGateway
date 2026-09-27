import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../../../lib/mongodb';
import { getSession } from '../../../../../../lib/auth';

export async function GET(req, { params }) {
  const session = getSession();
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { data: wd } = await mongoAdmin.from('withdrawals').select('*').eq('id', params.id).eq('type', 'instant').maybeSingle();
  if (!wd) return NextResponse.json({ success: false, error: 'WD tidak ditemukan' }, { status: 404 });
  if (String(wd.user_id) !== String(session.id)) return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });

  return NextResponse.json({
    success: true, status: wd.status, amount: wd.amount, operator: wd.operator, account_number: wd.account_number,
    total_fee: wd.fee, h2h_reason: wd.h2h_reason || null, saldo_refunded: wd.saldo_refunded || false,
    created_at: wd.created_at, completed_at: wd.completed_at || null
  });
}
