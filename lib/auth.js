import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';

const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = 'dp_session';

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}
export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export function signSession(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Set httpOnly cookie — token TIDAK bisa dibaca lewat document.cookie / devtools JS,
// beda dari versi lama yang expose apiKey/user id lewat localStorage & body request.
export function setSessionCookie(token) {
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 3600
  });
}
export function clearSessionCookie() {
  cookies().delete(COOKIE_NAME);
}

export function getSession() {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Constant-time-ish compare untuk API key admin (mencegah timing attack sederhana)
export function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function verifyAdminKey(req) {
  // admin.html lama kirim header 'x-api-key' (bukan 'x-admin-key'), diterima juga biar
  // gak perlu ubah HTML lama. Keduanya divalidasi ke ADMIN_API_KEY yang sama.
  const key = req.headers.get('x-admin-key') || req.headers.get('x-api-key');
  return !!key && safeEqual(key, process.env.ADMIN_API_KEY || '');
}
