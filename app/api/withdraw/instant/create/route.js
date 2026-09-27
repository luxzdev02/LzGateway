import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../../lib/mongodb';
import { getSession } from '../../../../../lib/auth';
import { generateTransactionId } from '../../../../../lib/security';
import { sendToOwner, sendWithdrawNotification } from '../../../../../lib/telegram';
import axios from 'axios';

const H2H_BASE_URL = 'https://api.h2h.id/api';
const H2H_EWALLET = {
  gopay: { product: 'BBSGOP', h2h_fee: 1000, label: 'GoPay' },
  ovo: { product: 'BBSOVO', h2h_fee: 900, label: 'OVO' },
  dana: { product: 'BBSDN', h2h_fee: 200, label: 'DANA' }
};
const MARKUP = parseInt(process.env.WITHDRAWAL_INSTANT_MARKUP || '2000');
const MIN_WITHDRAW = 10000, MAX_WITHDRAW = 10000000;
function formatRupiah(n) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n || 0); }

export async function POST(req) {
  const session = getSession();
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { amount, operator, account_number } = await req.json();
  if (!amount || amount < MIN_WITHDRAW) return NextResponse.json({ success: false, error: `Minimal withdraw ${formatRupiah(MIN_WITHDRAW)}` }, { status: 400 });
  if (amount > MAX_WITHDRAW) return NextResponse.json({ success: false, error: `Maksimal withdraw ${formatRupiah(MAX_WITHDRAW)}` }, { status: 400 });
  if (!operator || !H2H_EWALLET[operator]) return NextResponse.json({ success: false, error: 'Operator: dana, ovo, atau gopay' }, { status: 400 });
  if (!account_number) return NextResponse.json({ success: false, error: 'Nomor tujuan wajib diisi' }, { status: 400 });

  const H2H_MEMBER_ID = process.env.H2H_MEMBER_ID, H2H_PIN = process.env.H2H_PIN, H2H_PASSWORD = process.env.H2H_PASSWORD;
  if (!H2H_MEMBER_ID || !H2H_PIN || !H2H_PASSWORD) return NextResponse.json({ success: false, error: 'Withdraw instan belum dikonfigurasi.' }, { status: 503 });

  const cfg = H2H_EWALLET[operator];
  const totalFee = cfg.h2h_fee + MARKUP;
  const totalDeducted = amount + totalFee;

  // 1. Potong saldo dulu, atomic & anti-saldo-negatif
  const { data: deducted, error: deductErr } = await mongoAdmin.rpc('deduct_balance_atomic', { p_user_id: session.id, p_amount: totalDeducted });
  if (deductErr) {
    console.error('deduct_balance_atomic error:', deductErr.message);
    return NextResponse.json({ success: false, error: `Gagal memproses saldo: ${deductErr.message}` }, { status: 500 });
  }
  if (!deducted || deducted.length === 0) {
    const { data: u } = await mongoAdmin.from('users').select('balance').eq('id', session.id).maybeSingle();
    return NextResponse.json({ success: false, error: `Saldo tidak cukup. Butuh: ${formatRupiah(totalDeducted)}. Saldo: ${formatRupiah(u?.balance || 0)}` }, { status: 400 });
  }
  const { data: user } = await mongoAdmin.from('users').select('*').eq('id', session.id).maybeSingle();

  const kodeTrx = generateTransactionId('WDI');
  const h2hRefId = `H2H${Date.now()}${Math.floor(Math.random() * 999)}`;
  const newWithdraw = {
    id: kodeTrx, type: 'instant', user_id: user.id, username: user.username, amount, fee: totalFee,
    h2h_fee: cfg.h2h_fee, markup_fee: MARKUP, total_diterima: amount, operator, account_number,
    h2h_ref_id: h2hRefId, h2h_product: cfg.product, status: 'processing',
    saldo_before: deducted[0].balance + totalDeducted, saldo_after: deducted[0].balance, saldo_refunded: false
  };
  await mongoAdmin.from('withdrawals').insert(newWithdraw);
  await sendWithdrawNotification(newWithdraw, user, formatRupiah);

  try {
    const h2hUrl = `${H2H_BASE_URL}/trx?product=${cfg.product}&dest=${account_number}&refID=${h2hRefId}&memberID=${H2H_MEMBER_ID}&pin=${H2H_PIN}&password=${H2H_PASSWORD}&qty=${amount}`;
    const h2hResp = await axios.get(h2hUrl, { timeout: 25000 });
    if (!h2hResp.data?.status) throw new Error(h2hResp.data?.message || 'H2H menolak order');

    const h2hData = h2hResp.data.data || {};
    const patch = { h2h_invoice: h2hData.invoice, h2h_price: h2hData.price };
    if (h2hData.transaction_status === 'success') { patch.status = 'success'; patch.completed_at = new Date().toISOString(); }
    await mongoAdmin.from('withdrawals').update(patch).eq('id', kodeTrx);

    await sendToOwner(`⚡ *WD INSTAN DIPROSES*\n👤 ${user.username}\n💸 ${formatRupiah(amount)} → ${cfg.label}\n📱 ${account_number}\n🧾 ID: ${kodeTrx}\n📊 H2H: ${h2hData.transaction_status || 'pending'}`);

    return NextResponse.json({ success: true, withdraw: { id: kodeTrx, type: 'instant', amount, fee: totalFee, total_diterima: amount, operator: cfg.label, account_number, status: h2hData.transaction_status === 'success' ? 'success' : 'processing', message: 'Withdraw instan sedang diproses. Biasanya 1-5 menit.' } });
  } catch (h2hError) {
    // Refund atomic kalau H2H gagal / error network
    await mongoAdmin.rpc('refund_balance_atomic', { p_user_id: user.id, p_amount: totalDeducted });
    await mongoAdmin.from('withdrawals').update({ status: 'failed', h2h_reason: h2hError.message, saldo_refunded: true, failed_at: new Date().toISOString() }).eq('id', kodeTrx);
    await sendToOwner(`❌ *WD INSTAN GAGAL - SALDO DIKEMBALIKAN*\n👤 ${user.username}\n+${formatRupiah(totalDeducted)} dikembalikan\nError: ${h2hError.message}`);
    return NextResponse.json({ success: false, error: 'Withdraw instan gagal diproses, saldo sudah dikembalikan.' }, { status: 500 });
  }
}
