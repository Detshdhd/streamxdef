import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // standalone is for Docker/Oracle self-hosting; Vercel needs its own build
  ...(process.env.VERCEL ? {} : { output: 'standalone' as const }),
  reactStrictMode: false,
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'image.tmdb.org' },
      { protocol: 'https', hostname: 'vimeus.com' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "frame-src 'self' https://vimeus.com https://*.vimeus.com https://*.goodstream.one https://*.voe.sx https://*.filemoon.sx https://*.vimeos.net https://*.streamtape.com https://*.doodstream.com https://*.mixdrop.ag https://vidrock.ru",
              "img-src 'self' data: https://image.tmdb.org https://vimeus.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self' https://api.themoviedb.org https://vimeus.com https://*.vimeus.com https://*.goodstream.one https://*.voe.sx https://*.filemoon.sx https://*.vimeos.net https://*.hakunaymatata.com https://*.1shows.app https://*.tiktokcdn.com https://vidrock.ru https://*.workers.dev https://vidvault.ru https://*.ironwallnet.net https://*.jenks426set.com https://*.lizer123.site https://api.opensubtitles.com https://*.opensubtitles.com",
              "media-src 'self' blob: https://*.goodstream.one https://*.voe.sx https://*.filemoon.sx https://*.vimeos.net https://*.hakunaymatata.com https://*.1shows.app https://*.tiktokcdn.com https://*.workers.dev https://*.ironwallnet.net https://*.jenks426set.com https://*.lizer123.site",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
