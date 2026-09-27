import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { sendToOwner, sendDepositSuccessNotification } from '../../../../lib/telegram';
import axios from 'axios';

function formatRupiah(n) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n || 0); }

// Dipanggil oleh Vercel Cron (lihat vercel.json) tiap menit — pengganti cron.schedule('*/30 * * * * *')
// node-cron lama, yang TIDAK bisa jalan di serverless karena proses tidak persist antar-request.
export async function GET(req) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: pending } = await mongoAdmin.from('deposits').select('*')
    .eq('status', 'pending').gt('expired_at', new Date().toISOString());
  if (!pending || pending.length === 0) return NextResponse.json({ ok: true, checked: 0 });

  const apiKeyGopay = process.env.GOPAY_MERCHANT_API_KEY;
  const tokenGopay = process.env.GOPAY_MERCHANT_TOKEN;
  if (!apiKeyGopay || !tokenGopay) {
    return NextResponse.json({ ok: false, error: 'GOPAY_MERCHANT_API_KEY / GOPAY_MERCHANT_TOKEN belum dikonfigurasi.' });
  }

  const url = `https://orkutxgomerch-rosy.vercel.app/api/gopay/mutasi-qris?apikey=${apiKeyGopay}&token=${encodeURIComponent(tokenGopay)}`;
  let mutations = [];
  try {
    const response = await axios.get(url, { timeout: 20000 });
    if (!response.data?.success) throw new Error(response.data?.message || 'Gagal mengambil mutasi');
    mutations = response.data?.data || [];
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message });
  }

  let credited = 0;
  for (const mut of mutations) {
    if (mut.status !== 'success') continue;
    const nominal = Number(mut.amount) || 0;
    if (nominal <= 0) continue;

    // reference_id dari GoPay Merchant sudah unik per transaksi, jadi bisa langsung
    // dipakai sebagai kunci dedup (lebih andal dibanding kunci waktu+nominal yang lama).
    const mutKey = mut.reference_id || mut.id;
    if (!mutKey) continue;

    const { data: used } = await mongoAdmin.from('mutation_log').select('mut_key').eq('mut_key', mutKey).maybeSingle();
    if (used) continue;

    const match = pending.find(d => d.total_bayar === nominal && !d.mutation_key);
    if (!match) continue;

    if (mut.time) {
      const mutTime = new Date(mut.time).getTime();
      if (!Number.isNaN(mutTime) && mutTime < new Date(match.created_at).getTime() - 7200000) continue;
    }

    // Insert dulu ke mutation_log dengan PK unik → kalau race, insert kedua akan gagal (unique violation), aman dari double-credit.
    const { error: logErr } = await mongoAdmin.from('mutation_log').insert({ mut_key: mutKey });
    if (logErr) continue; // sudah diklaim proses lain barengan

    // credit_deposit_atomic: hanya sukses kalau status masih 'pending' → anti double-credit juga di level deposit.
    const { data: result } = await mongoAdmin.rpc('credit_deposit_atomic', { p_deposit_id: match.id, p_mutation_key: mutKey });
    if (!result || result.length === 0) continue;

    credited++;
    const { data: user } = await mongoAdmin.from('users').select('*').eq('id', match.user_id).maybeSingle();
    if (user) {
      await sendDepositSuccessNotification({ ...match, status: 'success' }, user, formatRupiah);
      await sendToOwner(`✅ *DEPOSIT BERHASIL*\n👤 ${user.username}\n+${formatRupiah(match.amount)}\n💵 Saldo: ${formatRupiah(user.balance)}`);
    }
  }

  return NextResponse.json({ ok: true, checked: pending.length, credited });
}
