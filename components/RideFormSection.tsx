'use client'

import RideComparisonForm from '@/components/ride-comparison-form'

interface RideFormSectionProps {
  selectedRoute: { pickup: string; destination: string } | null
  onRouteProcessed: () => void
}

export default function RideFormSection({ selectedRoute, onRouteProcessed }: RideFormSectionProps) {
  return (
    <section
      id="compare"
      className="relative snap-start min-h-screen scroll-mt-24 sm:scroll-mt-28 bg-background overflow-visible py-8 sm:py-12 scanline-overlay"
    >
      {/* Dot Grid Background */}
      <div className="absolute inset-0 bg-dot-grid opacity-30" />

      {/* Platform Stripes Top/Bottom */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-platform-stripe opacity-50" />
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-platform-stripe opacity-50" />

      <div className="relative z-10 container mx-auto px-4 max-w-4xl w-full">
        <div className="text-center mb-10 sm:mb-12">
          <span className="font-mono text-xs tracking-widest uppercase text-primary mb-4 block">
            ● System Ready
          </span>
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-display font-normal text-foreground mb-4 tracking-tight uppercase">
            Compare Prices
          </h2>
          <p className="text-muted-foreground text-lg sm:text-xl max-w-2xl mx-auto font-mono">
            Enter your pickup and destination for{' '}
            <span className="text-foreground font-semibold">real-time price comparisons</span>
          </p>
        </div>

        <div className="card-transit p-6 sm:p-10 scroll-mt-20">
          <RideComparisonForm selectedRoute={selectedRoute} onRouteProcessed={onRouteProcessed} />
        </div>

        <div className="mt-10 text-center">
          <p className="text-xs font-mono text-muted-foreground max-w-md mx-auto uppercase tracking-wider">
            We compare prices from multiple services to help you find the best deal.
            <span className="text-foreground/70 font-medium">
              {' '}
              No booking fees or hidden charges.
            </span>
          </p>
        </div>
      </div>
    </section>
  )
}
