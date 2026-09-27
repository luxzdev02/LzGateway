import { NextResponse } from 'next/server';
import { mongoAdmin } from '../../../lib/mongodb';
import { verifyPassword, signSession, setSessionCookie } from '../../../lib/auth';

export async function POST(req) {
  const { username, password } = await req.json();
  if (!username || !password)
    return NextResponse.json({ error: 'Username dan password wajib diisi' }, { status: 400 });

  const { data: user } = await mongoAdmin.from('users').select('*').eq('username', username).maybeSingle();
  if (!user) return NextResponse.json({ error: 'Username atau password salah' }, { status: 401 });

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return NextResponse.json({ error: 'Username atau password salah' }, { status: 401 });
  if (user.suspended) return NextResponse.json({ error: 'Akun Anda telah di-suspend. Hubungi admin.' }, { status: 403 });

  const token = signSession(user);
  setSessionCookie(token);

  // apiKey TIDAK dikirim balik ke browser secara default lagi (dulu bocor lewat view-source/localStorage).
  // Kalau frontend lama butuh apiKey untuk fitur tertentu, ambil lewat GET /api/user/me setelah login.
  return NextResponse.json({ success: true, user: { id: user.id, username: user.username, balance: user.balance } });
}
