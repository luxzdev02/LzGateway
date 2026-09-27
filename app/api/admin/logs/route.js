import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { verifyAdminKey } from '../../../../lib/auth';

export async function GET(req) {
  if (!verifyAdminKey(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') || '50');
  const { data: logs } = await mongoAdmin.from('admin_logs').select('*').order('timestamp', { ascending: false }).limit(limit);
  return NextResponse.json({ success: true, total_logs: logs.length, data: logs });
}
