'use client'

import { UserMenu, ThemeToggle } from '@/components/user-menu'
import { ArrowRight } from 'lucide-react'

export default function Hero() {
  return (
    <section
      id="home"
      className="relative snap-start min-h-screen overflow-hidden flex flex-col justify-center py-16 sm:py-24 md:py-32"
    >
      {/* Gradient Mesh Background with Noise Texture */}
      <div className="absolute inset-0 gradient-mesh noise-overlay" />

      {/* User menu and theme toggle */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <ThemeToggle />
        <UserMenu />
      </div>

      <div className="relative z-10 container mx-auto px-4 max-w-4xl w-full">
        <div className="text-center">
          {/* Main Headline */}
          <div className="animate-fade-in-up">
            <h1 className="font-display text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-normal mb-8 leading-[1.1] tracking-tight text-foreground">
              <span className="block animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
                Compare rides.
              </span>
              <span className="block animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
                Save money.
              </span>
              <span className="block animate-fade-in-up" style={{ animationDelay: '0.6s' }}>
                Travel <span className="text-accent-gradient">smarter</span>.
              </span>
            </h1>
          </div>

          <div className="animate-fade-in-up" style={{ animationDelay: '0.6s' }}>
            <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-xl mx-auto font-sans leading-relaxed tracking-wide">
              Real-time fare comparison across Uber, Lyft, and Taxi services in the Bay Area.
            </p>

            {/* Decorative Accent Line */}
            <div className="flex items-center justify-center gap-3 mb-8">
              <div className="h-px w-12 bg-gradient-to-r from-transparent to-secondary/60" />
              <div className="w-1.5 h-1.5 rounded-full bg-secondary/80" />
              <div className="h-px w-12 bg-gradient-to-l from-transparent to-secondary/60" />
            </div>
          </div>

          {/* Frosted Glass CTA Card */}
          <div className="animate-fade-in-up" style={{ animationDelay: '0.8s' }}>
            <div className="glass-card rounded-2xl p-8 max-w-md mx-auto mb-16">
              <p className="font-display text-xl sm:text-2xl text-foreground mb-6">
                Where are you going?
              </p>
              <a
                href="#compare"
                className="group inline-flex items-center justify-center gap-3 w-full px-8 py-4 bg-primary text-primary-foreground font-sans font-medium text-lg rounded-xl transition-all duration-300 hover:shadow-lg hover:shadow-primary/25 hover:scale-[1.02]"
              >
                <span>Compare Now</span>
                <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
              </a>
            </div>
          </div>

          {/* Floating Stat Cards */}
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 sm:gap-6">
            {/* Stat Card 1 */}
            <div
              className="glass-card card-accent-border float-hover rounded-xl px-6 py-4 min-w-[180px] animate-fade-in-up"
              style={{ animationDelay: '0.2s' }}
            >
              <div className="font-display text-3xl sm:text-4xl text-foreground mb-1 tabular-nums">
                40%
              </div>
              <div className="font-sans text-sm text-muted-foreground tracking-wide">
                Average Savings
              </div>
            </div>

            {/* Stat Card 2 */}
            <div
              className="glass-card card-accent-border float-hover rounded-xl px-6 py-4 min-w-[180px] animate-fade-in-up"
              style={{ animationDelay: '0.4s' }}
            >
              <div className="font-display text-3xl sm:text-4xl text-foreground mb-1 tabular-nums">
                3
              </div>
              <div className="font-sans text-sm text-muted-foreground tracking-wide">
                Services Compared
              </div>
            </div>

            {/* Stat Card 3 */}
            <div
              className="glass-card card-accent-border float-hover rounded-xl px-6 py-4 min-w-[180px] animate-fade-in-up"
              style={{ animationDelay: '0.6s' }}
            >
              <div className="font-display text-3xl sm:text-4xl text-foreground mb-1 tabular-nums">
                &lt;200ms
              </div>
              <div className="font-sans text-sm text-muted-foreground tracking-wide">
                Response Time
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
