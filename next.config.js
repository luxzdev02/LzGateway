/** @type {import('next').NextConfig} */
const ALLOWED_ORIGIN = process.env.WEBSITE_URL || '';

const nextConfig = {
  async rewrites() {
    // Pengganti `cleanPages` di Express lama (app.get('/dashboard') -> sendFile dashboard.html)
    return [
      { source: '/', destination: '/index.html' },
      { source: '/dashboard', destination: '/dashboard.html' },
      { source: '/deposit', destination: '/deposit.html' },
      { source: '/withdraw', destination: '/withdraw.html' },
      { source: '/riwayat', destination: '/riwayat.html' },
      { source: '/profile', destination: '/profile.html' },
      { source: '/docs', destination: '/docs.html' },
      { source: '/chat', destination: '/chat.html' },
      { source: '/admin', destination: '/admin.html' },
      { source: '/login', destination: '/login.html' }
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
        ]
      },
      {
        // CORS dibatasi ke domain sendiri saja untuk endpoint API-key-based (dulu cors() default
        // mengizinkan SEMUA origin, artinya siapa pun bisa fetch API dari domain lain).
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: ALLOWED_ORIGIN },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, X-Api-Key, X-Admin-Key' }
        ]
      }
    ];
  }
};

module.exports = nextConfig;
