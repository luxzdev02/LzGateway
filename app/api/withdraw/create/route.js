import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { getSession } from '../../../../lib/auth';
import { generateTransactionId } from '../../../../lib/security';
import { sendToOwner, sendWithdrawNotification } from '../../../../lib/telegram';

const WITHDRAWAL_FEE = parseInt(process.env.WITHDRAWAL_FEE || '1000');
const MIN_WITHDRAW = 5000, MAX_WITHDRAW = 1001000;
function formatRupiah(n) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n || 0); }

export async function POST(req) {
  const session = getSession();
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { amount, operator, account_number } = await req.json();
  if (!amount || amount < MIN_WITHDRAW) return NextResponse.json({ success: false, error: `Minimal withdraw ${formatRupiah(MIN_WITHDRAW)}` }, { status: 400 });
  if (amount > MAX_WITHDRAW) return NextResponse.json({ success: false, error: `Maksimal withdraw ${formatRupiah(MAX_WITHDRAW)}` }, { status: 400 });
  if (!operator || !['dana', 'ovo', 'gopay'].includes(operator)) return NextResponse.json({ success: false, error: 'Operator: dana, ovo, atau gopay' }, { status: 400 });
  if (!account_number) return NextResponse.json({ success: false, error: 'Nomor tujuan wajib diisi' }, { status: 400 });

  const totalDiterima = amount - WITHDRAWAL_FEE;
  if (totalDiterima <= 0) return NextResponse.json({ success: false, error: 'Nominal terlalu kecil setelah fee' }, { status: 400 });

  // Atomic: potong saldo HANYA jika cukup, dalam satu update (mencegah balance jadi negatif
  // kalau ada 2 request withdraw dikirim bersamaan / double-click).
  const { data: deducted, error: deductErr } = await mongoAdmin.rpc('deduct_balance_atomic', { p_user_id: session.id, p_amount: amount });
  if (deductErr) {
    console.error('deduct_balance_atomic error:', deductErr.message);
    return NextResponse.json({ success: false, error: `Gagal memproses saldo: ${deductErr.message}` }, { status: 500 });
  }
  if (!deducted || deducted.length === 0) {
    const { data: u } = await mongoAdmin.from('users').select('balance').eq('id', session.id).maybeSingle();
    return NextResponse.json({ success: false, error: `Saldo tidak cukup. Saldo Anda: ${formatRupiah(u?.balance || 0)}` }, { status: 400 });
  }

  const { data: user } = await mongoAdmin.from('users').select('*').eq('id', session.id).maybeSingle();
  const kodeTrx = generateTransactionId('WD');
  const newWithdraw = { id: kodeTrx, type: 'manual', user_id: user.id, username: user.username, amount, fee: WITHDRAWAL_FEE, total_diterima: totalDiterima, operator, account_number, status: 'pending' };
  await mongoAdmin.from('withdrawals').insert(newWithdraw);

  await sendWithdrawNotification(newWithdraw, user, formatRupiah);
  await sendToOwner(
    `💸 *PENARIKAN MANUAL BARU*\n👤 ${user.username} (${user.id})\n💰 ${formatRupiah(amount)}\n💵 Diterima: ${formatRupiah(totalDiterima)}\n🏦 ${operator.toUpperCase()}\n📱 ${account_number}\n🧾 ID: ${kodeTrx}`,
    { reply_markup: { inline_keyboard: [[{ text: '✅ Proses', callback_data: `process_wd_${kodeTrx}` }, { text: '❌ Gagal', callback_data: `fail_wd_${kodeTrx}` }]] } }
  );

  return NextResponse.json({ success: true, withdraw: { id: kodeTrx, amount, fee: WITHDRAWAL_FEE, total_diterima: totalDiterima, operator, account_number, status: 'pending' } });
}
