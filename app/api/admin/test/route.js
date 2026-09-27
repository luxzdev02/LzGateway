import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { verifyAdminKey } from '../../../../lib/auth';

export async function GET(req) {
  if (!verifyAdminKey(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { count } = await mongoAdmin.from('users').select('*', { count: 'exact', head: true });
  return NextResponse.json({ success: true, message: 'Admin API OK', total_users: count });
}
