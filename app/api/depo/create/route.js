import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { getSession } from '../../../../lib/auth';
import { generateTransactionId, checkRateLimit, getClientIp } from '../../../../lib/security';
import { sendToOwner } from '../../../../lib/telegram';
import axios from 'axios';

const SPAM_PENDING_THRESHOLD = parseInt(process.env.SPAM_PENDING_THRESHOLD || '20');

function formatRupiah(n) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
}

export async function POST(req) {
  const session = getSession();
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized, silakan login ulang' }, { status: 401 });

  const ok = await checkRateLimit('deposit', getClientIp(req), 10, 60_000);
  if (!ok) return NextResponse.json({ success: false, error: 'Terlalu banyak request deposit dalam 1 menit. Coba lagi sebentar.' }, { status: 429 });

  const { nominal } = await req.json();
  if (!nominal || nominal < 500) return NextResponse.json({ success: false, error: 'Minimal deposit Rp500' }, { status: 400 });
  if (nominal > 1000000) return NextResponse.json({ success: false, error: 'Maksimal deposit Rp1.000.000' }, { status: 400 });

  const { data: user } = await mongoAdmin.from('users').select('*').eq('id', session.id).maybeSingle();
  if (!user) return NextResponse.json({ success: false, error: 'User tidak ditemukan' }, { status: 404 });
  if (user.suspended) return NextResponse.json({ success: false, error: 'Akun Anda di-suspend. Hubungi admin.' }, { status: 403 });

  const { count: pendingCount } = await mongoAdmin
    .from('deposits').select('*', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('status', 'pending').gt('expired_at', new Date().toISOString());
  if ((pendingCount || 0) >= SPAM_PENDING_THRESHOLD) {
    return NextResponse.json({ success: false, error: `Anda memiliki ${pendingCount} deposit pending aktif. Batalkan atau tunggu expire.`, pending_count: pendingCount }, { status: 429 });
  }

  const randomFee = Math.floor(Math.random() * 50) + 1;
  const totalBayar = nominal + randomFee;
  const kodeTrx = generateTransactionId('FP');
  const expireTime = new Date(Date.now() + 3600000);

  try {
    const apiKeyGopay = process.env.GOPAY_MERCHANT_API_KEY;
    const staticQr = process.env.GOPAY_MERCHANT_STATIC_QR;
    if (!apiKeyGopay || !staticQr) {
      throw new Error('GOPAY_MERCHANT_API_KEY / GOPAY_MERCHANT_STATIC_QR belum dikonfigurasi di server.');
    }

    const createUrl = `https://orkutxgomerch-rosy.vercel.app/api/gopay/create-qris?apikey=${apiKeyGopay}&amount=${totalBayar}&static_qr=${encodeURIComponent(staticQr)}`;
    const response = await axios.get(createUrl, { timeout: 15000 });
    if (!response.data?.success) throw new Error(response.data?.message || 'Gagal membuat QRIS');
    const qrImageUrl = response.data.image_url;
    if (!qrImageUrl) throw new Error('QRIS image tidak ditemukan');

    const { error } = await mongoAdmin.from('deposits').insert({
      id: kodeTrx, user_id: user.id, username: user.username, amount: nominal, fee: randomFee,
      total_bayar: totalBayar, qr_image: qrImageUrl, status: 'pending', source: 'web', expired_at: expireTime
    });
    if (error) throw new Error(error.message);

    await sendToOwner(`💰 *DEPOSIT WEB BARU*\n👤 ${user.username}\n💰 ${formatRupiah(nominal)}\n💵 Total: ${formatRupiah(totalBayar)}\n🧾 ${kodeTrx}`);

    return NextResponse.json({ success: true, deposit: { id: kodeTrx, amount: nominal, fee: randomFee, total_payment: totalBayar, qr_image: qrImageUrl, status: 'pending', expired_at: expireTime.getTime() } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
