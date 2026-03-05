'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { Mail, Check } from 'lucide-react'

interface AuthDialogProps {
  onClose?: () => void
  onSuccess?: () => void
}

export function AuthDialog({ onClose, onSuccess }: AuthDialogProps) {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const emailInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    emailInputRef.current?.focus()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await signIn(email, password)

    if (error) {
      setError(error.message || 'Invalid email or password')
      setLoading(false)
    } else {
      setSuccess(true)
      setLoading(false)
      setTimeout(() => {
        onSuccess?.()
        onClose?.()
      }, 1000)
    }
  }

  if (success) {
    return (
      <div className="card-elevated rounded-xl p-8 border border-secondary/30">
        <div className="space-y-6">
          <div className="space-y-3 text-center">
            <div className="w-16 h-16 bg-secondary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-secondary" />
            </div>
            <h3 className="text-2xl font-bold text-foreground">Signed in successfully!</h3>
            <p className="text-muted-foreground">
              Welcome back, <strong className="text-foreground">{email}</strong>
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-full px-4 py-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-all duration-200"
          >
            Continue
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="card-elevated rounded-xl p-8">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-3 text-center">
          <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-2">
            <Mail className="w-6 h-6 text-primary" />
          </div>
          <h3 id="auth-dialog-title" className="text-2xl font-bold text-foreground">
            Sign in to save routes
          </h3>
          <p className="text-muted-foreground">Enter your email and password to continue</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-foreground">
            Email
          </label>
          <input
            ref={emailInputRef}
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            disabled={loading}
            className="w-full px-4 py-3 bg-muted border border-border rounded-lg text-foreground placeholder-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 outline-none"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            Password
          </label>
          <input
            id="password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            disabled={loading}
            className="w-full px-4 py-3 bg-muted border border-border rounded-lg text-foreground placeholder-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 outline-none"
          />
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 px-4 py-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 rounded-lg card-interactive text-muted-foreground hover:text-foreground font-medium transition-all duration-200"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
