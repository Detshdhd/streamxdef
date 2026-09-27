import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: '#0f0e17',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "StreamX — Tu lugar para pelis y series",
  description: "Disfruta miles de películas y series en alta calidad. Sin anuncios, sin complicaciones.",
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* crossOrigin: las miniaturas se reescalan en canvas GPU, así que
            TMDB debe responder con CORS — el preconnect también lo negocia. */}
        <link rel="preconnect" href="https://image.tmdb.org" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://image.tmdb.org" />
        {/* Precarga las dos primeras filas tras el hero (que ya viaja
            embebido en el HTML): arrancan al parsear el documento, en
            paralelo con el JS, y el fetch del client las encuentra calientes. */}
        <link rel="preload" as="fetch" href="/api/tmdb?type=top-rated" crossOrigin="anonymous" />
        <link rel="preload" as="fetch" href="/api/tmdb?type=popular-tv" crossOrigin="anonymous" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
