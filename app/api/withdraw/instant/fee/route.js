import { NextResponse } from 'next/server';

const H2H_EWALLET = {
  gopay: { h2h_fee: 1000, label: 'GoPay' },
  ovo: { h2h_fee: 900, label: 'OVO' },
  dana: { h2h_fee: 200, label: 'DANA' }
};
const MARKUP = parseInt(process.env.WITHDRAWAL_INSTANT_MARKUP || '1000');

export async function GET() {
  const result = {};
  Object.entries(H2H_EWALLET).forEach(([op, cfg]) => {
    result[op] = { h2h_fee: cfg.h2h_fee, markup_fee: MARKUP, total_fee: cfg.h2h_fee + MARKUP, label: cfg.label };
  });
  return NextResponse.json({ success: true, fees: result });
}
