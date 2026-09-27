import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { getSession } from '../../../../lib/auth';

export async function POST(req) {
  const session = getSession();
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { deposit_id } = await req.json();
  if (!deposit_id) return NextResponse.json({ success: false, error: 'Deposit ID required' }, { status: 400 });

  const { data: deposit } = await mongoAdmin.from('deposits').select('*').eq('id', deposit_id).maybeSingle();
  if (!deposit) return NextResponse.json({ success: false, error: 'Deposit not found' }, { status: 404 });
  if (deposit.user_id !== session.id) return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });

  if (deposit.status === 'success') return NextResponse.json({ success: true, status: 'success', message: 'Deposit berhasil! Saldo bertambah.' });
  if (deposit.status === 'canceled') return NextResponse.json({ success: true, status: 'canceled', message: 'Deposit dibatalkan' });
  if (deposit.status === 'expired') return NextResponse.json({ success: true, status: 'expired', message: 'Deposit expired' });

  if (new Date() > new Date(deposit.expired_at)) {
    // Atomic: hanya berhasil expire kalau status masih 'pending' saat ini di DB.
    const { data } = await mongoAdmin.rpc('expire_deposit_atomic', { p_deposit_id: deposit_id });
    if (data && data.length > 0) return NextResponse.json({ success: true, status: 'expired', message: 'Deposit expired' });
    // Kalau rpc return kosong, berarti barengan sudah diubah proses lain (misal baru saja success/canceled) — re-fetch.
    const { data: fresh } = await mongoAdmin.from('deposits').select('status').eq('id', deposit_id).maybeSingle();
    return NextResponse.json({ success: true, status: fresh?.status || 'expired' });
  }

  return NextResponse.json({ success: true, status: 'pending', message: 'Menunggu pembayaran. Auto-cek setiap 30 detik.' });
}
