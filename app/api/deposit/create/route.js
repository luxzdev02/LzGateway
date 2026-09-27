import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { generateTransactionId, checkRateLimit, getClientIp } from '../../../../lib/security';
import { tgSendPhoto } from '../../../../lib/telegram';
import axios from 'axios';

const SPAM_PENDING_THRESHOLD = parseInt(process.env.SPAM_PENDING_THRESHOLD || '20');
function formatRupiah(n) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n || 0); }

export async function POST(req) {
  const ok = await checkRateLimit('deposit', getClientIp(req), 10, 60_000);
  if (!ok) return NextResponse.json({ success: false, error: 'Terlalu banyak request dalam 1 menit.' }, { status: 429 });

  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) return NextResponse.json({ success: false, error: 'API Key required' }, { status: 401 });

  const { amount } = await req.json();
  if (!amount || amount < 500) return NextResponse.json({ success: false, error: 'Minimal deposit Rp500' }, { status: 400 });
  if (amount > 1000000) return NextResponse.json({ success: false, error: 'Maksimal deposit Rp1.000.000' }, { status: 400 });

  const { data: user } = await mongoAdmin.from('users').select('*').eq('api_key', apiKey).maybeSingle();
  if (!user) return NextResponse.json({ success: false, error: 'Invalid API Key' }, { status: 401 });
  if (user.suspended) return NextResponse.json({ success: false, error: 'Akun Anda di-suspend.' }, { status: 403 });

  const { count } = await mongoAdmin.from('deposits').select('*', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('status', 'pending').gt('expired_at', new Date().toISOString());
  if ((count || 0) >= SPAM_PENDING_THRESHOLD)
    return NextResponse.json({ success: false, error: `Terlalu banyak deposit pending (${count}).`, pending_count: count }, { status: 429 });

  const randomFee = Math.floor(Math.random() * 50) + 1, totalBayar = amount + randomFee;
  const kodeTrx = generateTransactionId('FP'), expireTime = new Date(Date.now() + 3600000);

  try {
    const apiKeyGopay = process.env.GOPAY_MERCHANT_API_KEY;
    const staticQr = process.env.GOPAY_MERCHANT_STATIC_QR;
    if (!apiKeyGopay || !staticQr) {
      throw new Error('GOPAY_MERCHANT_API_KEY / GOPAY_MERCHANT_STATIC_QR belum dikonfigurasi di server.');
    }

    const url = `https://orkutxgomerch-rosy.vercel.app/api/gopay/create-qris?apikey=${apiKeyGopay}&amount=${totalBayar}&static_qr=${encodeURIComponent(staticQr)}`;
    const r = await axios.get(url, { timeout: 15000 });
    if (!r.data?.success) throw new Error(r.data?.message || 'Gagal membuat QRIS');
    const qrImageUrl = r.data.image_url;
    if (!qrImageUrl) throw new Error('QRIS image tidak ditemukan');

    await mongoAdmin.from('deposits').insert({
      id: kodeTrx, user_id: user.id, username: user.username,
      amount, fee: randomFee, total_bayar: totalBayar, qr_image: qrImageUrl, status: 'pending', source: 'api', expired_at: expireTime
    });

    await tgSendPhoto(process.env.ADMIN_TELEGRAM_ID, qrImageUrl, `💰 *DEPOSIT API*\n👤 ${user.username}\n💰 ${formatRupiah(amount)}\n💵 Total: ${formatRupiah(totalBayar)}\n🧾 ${kodeTrx}`);

    return NextResponse.json({ success: true, deposit: { id: kodeTrx, amount, fee: randomFee, total_payment: totalBayar, qr_image: qrImageUrl, status: 'pending', expired_at: expireTime.getTime() } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
