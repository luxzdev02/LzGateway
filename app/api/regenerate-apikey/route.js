import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../lib/mongodb';
import { newApiKey } from '../../../lib/security';
import { getSession } from '../../../lib/auth';

export async function POST(req) {
  const apiKey = req.headers.get('x-api-key');
  const session = getSession();

  let user = null;
  if (apiKey) {
    const { data } = await mongoAdmin.from('users').select('id').eq('api_key', apiKey).maybeSingle();
    user = data;
  } else if (session) {
    // Perbaikan keamanan: dulu endpoint ini percaya begitu saja user_id dari body request
    // (siapapun bisa regenerate apiKey user lain hanya dengan tebak/lihat ID di network tab).
    // Sekarang WAJIB pakai apiKey lama ATAU session cookie login yang valid.
    user = { id: session.id };
  }
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const api_key = newApiKey();
  const { error } = await mongoAdmin.from('users').update({ api_key }).eq('id', user.id);
  if (error) return NextResponse.json({ success: false, error: 'Gagal generate' }, { status: 500 });

  return NextResponse.json({ success: true, message: 'API Key digenerate ulang', apiKey: api_key });
}
