import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';

export async function POST(req) {
  const apiKey = req.headers.get('x-api-key');
  const { deposit_id } = await req.json();
  if (!apiKey) return NextResponse.json({ success: false, error: 'API Key required' }, { status: 401 });
  if (!deposit_id) return NextResponse.json({ success: false, error: 'Deposit ID required' }, { status: 400 });

  const { data: user } = await mongoAdmin.from('users').select('id').eq('api_key', apiKey).maybeSingle();
  if (!user) return NextResponse.json({ success: false, error: 'Invalid API Key' }, { status: 401 });

  const { data: deposit } = await mongoAdmin.from('deposits').select('*').eq('id', deposit_id).maybeSingle();
  if (!deposit) return NextResponse.json({ success: false, error: 'Deposit not found' }, { status: 404 });
  if (deposit.user_id !== user.id) return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
  if (deposit.status === 'success') return NextResponse.json({ success: true, status: 'success', message: 'Deposit berhasil!' });
  if (deposit.status === 'canceled') return NextResponse.json({ success: true, status: 'canceled' });

  if (new Date() > new Date(deposit.expired_at) && deposit.status === 'pending') {
    const { data } = await mongoAdmin.rpc('expire_deposit_atomic', { p_deposit_id: deposit_id });
    if (data?.length) return NextResponse.json({ success: true, status: 'expired' });
  }
  return NextResponse.json({ success: true, status: deposit.status || 'pending', message: 'Menunggu pembayaran' });
}
