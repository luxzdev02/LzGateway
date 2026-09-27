import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../../lib/mongodb';
import { verifyAdminKey } from '../../../../../lib/auth';

export async function GET(req) {
  if (!verifyAdminKey(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');

  let q = mongoAdmin.from('deposits').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data: deposits } = await q;

  return NextResponse.json({
    success: true,
    stats: {
      total_success: deposits.filter(d => d.status === 'success').length,
      total_pending: deposits.filter(d => d.status === 'pending').length,
      total_nominal_success: deposits.filter(d => d.status === 'success').reduce((s, d) => s + (d.amount || 0), 0)
    },
    data: deposits
  });
}
