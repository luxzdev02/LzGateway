import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../lib/mongodb';

export async function POST(req) {
  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) return NextResponse.json({ success: false, error: 'API Key required' }, { status: 401 });
  const { data: user } = await mongoAdmin.from('users').select('balance, username').eq('api_key', apiKey).maybeSingle();
  if (!user) return NextResponse.json({ success: false, error: 'Invalid API Key' }, { status: 401 });
  return NextResponse.json({ success: true, balance: user.balance, username: user.username });
}
