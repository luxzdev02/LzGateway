import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../../lib/mongodb';
import { sendToOwner } from '../../../../lib/telegram';
import axios from 'axios';

const H2H_BASE_URL = 'https://api.h2h.id/api';
function formatRupiah(n) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n || 0); }

export async function GET(req) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: pending } = await mongoAdmin.from('withdrawals').select('*')
    .eq('type', 'instant').eq('status', 'processing').not('h2h_ref_id', 'is', null);
  if (!pending || pending.length === 0) return NextResponse.json({ ok: true, checked: 0 });

  const H2H_MEMBER_ID = process.env.H2H_MEMBER_ID, H2H_PIN = process.env.H2H_PIN, H2H_PASSWORD = process.env.H2H_PASSWORD;
  let updated = 0;

  for (const wd of pending) {
    try {
      const url = `${H2H_BASE_URL}/trx/status?refID=${wd.h2h_ref_id}&memberID=${H2H_MEMBER_ID}&pin=${H2H_PIN}&password=${H2H_PASSWORD}`;
      const resp = await axios.get(url, { timeout: 15000 });
      if (!resp.data?.status || !resp.data?.data) continue;
      const h2hStatus = resp.data.data.transaction_status;

      if (h2hStatus === 'success') {
        const { data: rows } = await mongoAdmin.from('withdrawals')
          .update({ status: 'success', completed_at: new Date().toISOString(), h2h_last_status: h2hStatus })
          .eq('id', wd.id).eq('status', 'processing').select();
        if (rows?.length) {
          updated++;
          await sendToOwner(`✅ *WD INSTAN SUKSES*\n👤 ${wd.username}\n💸 ${formatRupiah(wd.amount)} → ${wd.operator.toUpperCase()}`);
        }
      } else if (h2hStatus === 'failed') {
        const { data: rows } = await mongoAdmin.from('withdrawals')
          .update({ status: 'failed', h2h_reason: resp.data.data.reason || 'Gagal di provider', h2h_last_status: h2hStatus })
          .eq('id', wd.id).eq('status', 'processing').select();
        if (rows?.length && !wd.saldo_refunded) {
          await mongoAdmin.rpc('refund_balance_atomic', { p_user_id: wd.user_id, p_amount: wd.amount + wd.fee });
          await mongoAdmin.from('withdrawals').update({ saldo_refunded: true }).eq('id', wd.id);
          updated++;
          await sendToOwner(`❌ *WD INSTAN GAGAL - SALDO DIKEMBALIKAN*\n👤 ${wd.username}\n+${formatRupiah(wd.amount + wd.fee)} dikembalikan`);
        }
      } else {
        await mongoAdmin.from('withdrawals').update({ last_h2h_check: new Date().toISOString(), h2h_last_status: h2hStatus }).eq('id', wd.id);
      }
    } catch (e) { console.error(`Cek H2H WD ${wd.id}:`, e.message); }
  }
  return NextResponse.json({ ok: true, checked: pending.length, updated });
}
