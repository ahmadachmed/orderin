/**
 * Security headers — issue #252.
 *
 * Applied via next.config headers() (not middleware) because the config
 * path is server-level, cached, and matches every route (pages + API) for
 * the App Router. Middleware stays scoped to /api/:path* for rate limiting.
 *
 * HSTS is intentionally absent: Vercel already sends it at the edge, and
 * duplicating it here would risk conflicting values.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
