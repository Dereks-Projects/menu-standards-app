/*
 * Location: menu-standards-app/next.config.ts
 *
 * Next.js settings for Menu Standards, including the security headers sent
 * with every response.
 *
 * Content Security Policy: tells browsers which sources a page may load
 * scripts, styles, images, and fonts from, and blocks everything else. This
 * version allows the small inline scripts Next.js needs to start each page.
 * A stricter version, with a one-time code on every request, is a pending
 * pitch because it requires every page to render on request.
 * The Vercel preview toolbar is blocked by this policy on purpose.
 *
 * Search engines are told to skip every page until the landing page
 * launches. Secret link pages (/share and /learn) also send no referrer,
 * so their addresses are never passed to other sites.
 */

import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";

const contentSecurityPolicy = [
  "default-src 'self'",
  // The development server also needs eval for live reloading.
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Upgrading to https would break the local development server.
  ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Pre-launch: no page is indexed. The landing page step changes this
  // for marketing pages only.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

// Secret link pages. When two rules set the same header, the later rule
// wins, so these override the site-wide values above.
const secretLinkHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/share/:path*", headers: secretLinkHeaders },
      { source: "/learn/:path*", headers: secretLinkHeaders },
    ];
  },
};

export default nextConfig;