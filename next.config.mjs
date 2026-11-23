/** @type {import('next').NextConfig} */
const nextConfig = {
  // `pg` usa APIs nativas de Node; no debe empaquetarse para el bundle del servidor.
  serverExternalPackages: ['pg'],
  images: {
    unoptimized: true,
  },
  // La consola es una SPA Angular publicada en `public/` (ver
  // `scripts/copiar-spa.mjs`). Estas reglas devuelven `index.html` para que el
  // router del cliente resuelva `/` y las rutas profundas, sin tocar
  // `/api/**`, `/_next/**` ni los archivos con extensión.
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/', destination: '/index.html' },
        {
          source: '/:ruta((?!api/|_next/|.*\\..*).*)',
          destination: '/index.html',
        },
      ],
    }
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig
