import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { getSession } from '../../../../lib/auth';
import { sendToOwner } from '../../../../lib/telegram';

function formatRupiah(n) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
}

export async function POST(req) {
  const session = getSession();
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { deposit_id } = await req.json();
  if (!deposit_id) return NextResponse.json({ success: false, error: 'Deposit ID required' }, { status: 400 });

  // ============================================================
  // FIX BUG: dulu (readDB -> ubah di memory -> writeDB seluruh file)
  // race dengan auto-check deposit (cron 30 detik) yang jalan bersamaan.
  // Kalau auto-check baca file duluan, lalu proses ini overwrite, hasil
  // auto-check hilang (atau sebaliknya) — makanya "kadang tidak ter-cancel".
  //
  // Sekarang: satu UPDATE atomic di Postgres dengan kondisi
  // "WHERE status='pending' AND expired_at > now()" dalam SATU statement.
  // Kalau proses lain (mis. credit_deposit_atomic dari cron) sudah lebih
  // dulu mengubah status, UPDATE ini otomatis mengembalikan 0 baris —
  // tidak ada lagi kondisi menang-menangan antar proses.
  // ============================================================
  const { data, error } = await mongoAdmin.rpc('cancel_deposit_atomic', {
    p_deposit_id: deposit_id,
    p_user_id: session.id
  });

  if (error) return NextResponse.json({ success: false, error: 'Gagal memproses pembatalan' }, { status: 500 });

  if (!data || data.length === 0) {
    // Cek kenapa gagal supaya pesan error jelas ke user (bukan cuma "gagal")
    const { data: deposit } = await mongoAdmin.from('deposits').select('*').eq('id', deposit_id).maybeSingle();
    if (!deposit) return NextResponse.json({ success: false, error: 'Deposit not found' }, { status: 404 });
    if (deposit.user_id !== session.id) return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    if (new Date() > new Date(deposit.expired_at)) return NextResponse.json({ success: false, error: 'Deposit sudah expired' }, { status: 400 });
    return NextResponse.json({ success: false, error: `Status deposit: ${deposit.status}` }, { status: 400 });
  }

  const { data: deposit } = await mongoAdmin.from('deposits').select('*').eq('id', deposit_id).maybeSingle();
  await sendToOwner(`❌ Deposit dibatalkan: ${deposit.username} ${formatRupiah(deposit.amount)}`);

  return NextResponse.json({ success: true, message: 'Deposit berhasil dibatalkan' });
}
