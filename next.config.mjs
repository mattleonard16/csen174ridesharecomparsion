const isDev = process.env.NODE_ENV === 'development'

const securityHeaders = [
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'geolocation=(self), microphone=()',
  },
]

// Add HSTS and CSP only in production
const productionHeaders = isDev
  ? []
  : [
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains',
      },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.google.com https://www.gstatic.com",
          "worker-src 'self' blob:",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com",
          "font-src 'self'",
          "connect-src 'self' https://nominatim.openstreetmap.org https://router.project-osrm.org https://www.google.com https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com",
          'frame-src https://www.google.com',
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; '),
      },
    ]

const nextConfig = {
  output: 'standalone',
  // TypeScript and ESLint checks are now enforced at build time
  // This ensures type errors and linting issues don't hide security vulnerabilities
  transpilePackages: ['ngeohash'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [...securityHeaders, ...productionHeaders],
      },
    ]
  },
}

// Only load PWA in production to avoid babel compatibility issues
let config = nextConfig

if (!isDev) {
  const withPWA = (await import('next-pwa')).default

  const pwaConfig = {
    dest: 'public',
    disable: false,
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/.*\.basemaps\.cartocdn\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'carto-tiles',
          expiration: {
            maxEntries: 200,
            maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
          },
        },
      },
      {
        urlPattern: /^https:\/\/nominatim\.openstreetmap\.org\/.*/i,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'nominatim-api',
          expiration: {
            maxEntries: 50,
            maxAgeSeconds: 24 * 60 * 60, // 1 day
          },
        },
      },
      {
        urlPattern: /^https:\/\/router\.project-osrm\.org\/.*/i,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'osrm-api',
          expiration: {
            maxEntries: 50,
            maxAgeSeconds: 60 * 60, // 1 hour
          },
        },
      },
    ],
  }

  config = withPWA(pwaConfig)(nextConfig)
}

export default config
