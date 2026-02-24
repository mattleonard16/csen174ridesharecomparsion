'use client'

import { useState, useEffect } from 'react'
import { useTheme } from 'next-themes'
import { useAuth } from '@/lib/auth-context'
import { AuthDialog } from '@/components/auth-dialog'
import ModalPortal from '@/components/ModalPortal'
import { User, LogOut, Sun, Moon } from 'lucide-react'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return <div className="h-10 w-10 rounded-lg bg-muted animate-pulse" />
  }

  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="p-2.5 rounded-lg card-interactive text-foreground transition-all duration-200"
      title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {resolvedTheme === 'dark' ? (
        <Sun className="w-4 h-4" />
      ) : (
        <Moon className="w-4 h-4" />
      )}
    </button>
  )
}

export function UserMenu() {
  const { user, signOut, loading } = useAuth()
  const [showAuth, setShowAuth] = useState(false)

  if (loading) {
    return <div className="h-10 w-24 animate-pulse rounded-lg bg-muted" />
  }

  if (user) {
    return (
      <div className="card-solid rounded-lg px-4 py-2 flex items-center gap-3">
        <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
          <User className="w-4 h-4 text-primary" />
        </div>
        <span className="text-sm text-muted-foreground hidden sm:inline font-medium truncate max-w-[120px]">
          {user.email}
        </span>
        <button
          onClick={signOut}
          className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all duration-200"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        onClick={() => setShowAuth(true)}
        className="card-interactive px-5 py-2.5 rounded-lg text-foreground font-medium transition-all duration-200"
      >
        Sign in
      </button>
      {showAuth && (
        <ModalPortal>
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/90 p-4">
            <div className="relative z-[10000] w-full max-w-md">
              <AuthDialog onClose={() => setShowAuth(false)} onSuccess={() => setShowAuth(false)} />
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  )
}
