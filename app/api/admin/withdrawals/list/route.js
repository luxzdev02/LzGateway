import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../../lib/mongodb';
import { verifyAdminKey } from '../../../../../lib/auth';

export async function GET(req) {
  if (!verifyAdminKey(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { data: withdrawals } = await mongoAdmin.from('withdrawals').select('*').order('created_at', { ascending: false });

  return NextResponse.json({
    success: true,
    stats: {
      total_success: withdrawals.filter(w => w.status === 'success').length,
      total_pending: withdrawals.filter(w => ['pending', 'processing'].includes(w.status)).length,
      total_failed: withdrawals.filter(w => w.status === 'failed').length
    },
    data: withdrawals
  });
}
