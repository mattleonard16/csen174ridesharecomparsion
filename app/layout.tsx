import type { Metadata, Viewport } from 'next'
import { Playfair_Display, DM_Sans, Space_Mono } from 'next/font/google'
import dynamic from 'next/dynamic'
import './globals.css'
import { Analytics } from '@vercel/analytics/react'
import { Providers } from './providers'

const PillBase = dynamic(
  () => import('@/components/ui/3d-adaptive-navigation-bar').then(m => ({ default: m.PillBase })),
  { ssr: false }
)

const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
})

const dmSans = DM_Sans({
  weight: ['300', '400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
})

const spaceMono = Space_Mono({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-space-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Comparative Rideshares - Compare Uber, Lyft & Taxi',
  description: 'Compare prices and wait times across rideshare services in the Bay Area',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'RideCompare',
  },
  icons: {
    apple: '/icons/icon-180.svg',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#3b82f6',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${playfairDisplay.variable} ${dmSans.variable} ${spaceMono.variable} antialiased font-sans`}
      >
        <Providers>
          {/* Fixed Navigation Bar */}
          <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50">
            <PillBase />
          </div>
          {children}
          <Analytics />
        </Providers>
      </body>
    </html>
  )
}
