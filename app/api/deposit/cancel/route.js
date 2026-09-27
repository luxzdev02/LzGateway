import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';

export async function POST(req) {
  const apiKey = req.headers.get('x-api-key');
  const { deposit_id } = await req.json();
  if (!apiKey || !deposit_id) return NextResponse.json({ success: false, error: 'API Key & Deposit ID required' }, { status: 400 });

  const { data: user } = await mongoAdmin.from('users').select('id').eq('api_key', apiKey).maybeSingle();
  if (!user) return NextResponse.json({ success: false, error: 'Invalid API Key' }, { status: 401 });

  // Sama seperti /api/depo/cancel — atomic, tidak ada lagi race condition.
  const { data, error } = await mongoAdmin.rpc('cancel_deposit_atomic', { p_deposit_id: deposit_id, p_user_id: user.id });
  if (error) return NextResponse.json({ success: false, error: 'Gagal memproses' }, { status: 500 });

  if (!data || data.length === 0) {
    const { data: deposit } = await mongoAdmin.from('deposits').select('status,user_id').eq('id', deposit_id).maybeSingle();
    if (!deposit || deposit.user_id !== user.id) return NextResponse.json({ success: false, error: 'Not found or access denied' }, { status: 403 });
    return NextResponse.json({ success: false, error: `Status: ${deposit.status}` }, { status: 400 });
  }
  return NextResponse.json({ success: true, message: 'Deposit berhasil dibatalkan' });
}
