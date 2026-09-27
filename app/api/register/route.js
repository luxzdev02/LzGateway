import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../lib/mongodb';
import { hashPassword } from '../../../lib/auth';
import { getClientIp, newApiKey } from '../../../lib/security';
import { sendToOwner } from '../../../lib/telegram';

const MAX_REGISTER_PER_IP = parseInt(process.env.MAX_REGISTER_PER_IP || '2');

export async function POST(req) {
  const { username, password } = await req.json();

  if (!username || !/^[a-z0-9]{3,20}$/.test(username))
    return NextResponse.json({ success: false, error: 'Username 3-20 karakter, huruf kecil & angka' }, { status: 400 });
  if (!password || password.length < 4)
    return NextResponse.json({ success: false, error: 'Password minimal 4 karakter' }, { status: 400 });

  const ip = getClientIp(req);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await mongoAdmin
    .from('ip_register_log').select('*', { count: 'exact', head: true })
    .eq('ip', ip).gte('created_at', since);
  if ((count || 0) >= MAX_REGISTER_PER_IP)
    return NextResponse.json({ success: false, error: `Maksimal ${MAX_REGISTER_PER_IP} akun per IP per hari. Coba lagi besok.` }, { status: 429 });

  const { data: existing } = await mongoAdmin.from('users').select('id').eq('username', username).maybeSingle();
  if (existing) return NextResponse.json({ success: false, error: 'Username sudah terdaftar' }, { status: 400 });

  const password_hash = await hashPassword(password);
  const api_key = newApiKey();

  const { error } = await mongoAdmin.from('users').insert({ username, password_hash, api_key });
  if (error) return NextResponse.json({ success: false, error: 'Gagal registrasi' }, { status: 500 });

  await mongoAdmin.from('ip_register_log').insert({ ip });
  await sendToOwner(`🆕 *USER BARU*\n👤 ${username}`);

  return NextResponse.json({ success: true, message: 'Registrasi berhasil' });
}
