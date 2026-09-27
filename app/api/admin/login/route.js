import { NextResponse } from 'next/server';
import { safeEqual } from '../../../../lib/auth';

// PENTING: kode lama punya fallback default admin key hardcoded di source
// ("admin_digitalpedia_2024_secret_key_123") kalau ADMIN_API_KEY tidak diisi di .env —
// ini bug keamanan serius kalau env lupa di-set di production. Di sini TIDAK ada fallback;
// kalau ADMIN_API_KEY / ADMIN_USERNAME / ADMIN_PASSWORD kosong, login admin akan selalu gagal.
export async function POST(req) {
  const { username, password } = await req.json();
  const validUser = process.env.ADMIN_USERNAME, validPass = process.env.ADMIN_PASSWORD, adminKey = process.env.ADMIN_API_KEY;

  if (!validUser || !validPass || !adminKey)
    return NextResponse.json({ success: false, error: 'Admin belum dikonfigurasi di environment' }, { status: 503 });

  if (safeEqual(username || '', validUser) && safeEqual(password || '', validPass)) {
    return NextResponse.json({ success: true, adminToken: adminKey });
  }
  return NextResponse.json({ success: false, error: 'Username atau password salah' }, { status: 401 });
}
