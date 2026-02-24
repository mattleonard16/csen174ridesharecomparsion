'use client'

import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from 'next-themes'
import { AuthProvider } from '@/lib/auth-context'
import { Toaster } from 'sonner'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <SessionProvider>
        <AuthProvider>
          {children}
          <Toaster
            position="bottom-center"
            toastOptions={{
              className: 'bg-background text-foreground border-border',
            }}
          />
        </AuthProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
