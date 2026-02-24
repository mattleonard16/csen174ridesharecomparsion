import { Zap, Brain, MapPin, Clock, TrendingDown, Shield } from 'lucide-react'

const FEATURES = [
  {
    id: 'real-time',
    icon: Zap,
    title: 'Live Pricing',
    description: 'Current surge rates and fare estimates updated every 30 seconds.',
    stat: '30s',
    statLabel: 'refresh rate',
  },
  {
    id: 'smart-recommendations',
    icon: Brain,
    title: 'Smart Picks',
    description: 'We analyze price, wait time, and surge to recommend the best option.',
    stat: '3',
    statLabel: 'factors analyzed',
  },
  {
    id: 'bay-area',
    icon: MapPin,
    title: 'Bay Area Focus',
    description: 'Tuned for SF, Oakland, San Jose airports and tech campus routes.',
    stat: '50+',
    statLabel: 'popular routes',
  },
]

const SECONDARY_FEATURES = [
  {
    icon: Clock,
    title: 'Wait Time Estimates',
    description: 'Know exactly how long until your ride arrives.',
  },
  {
    icon: TrendingDown,
    title: 'Price Alerts',
    description: 'Get notified when prices drop on your frequent routes.',
  },
  {
    icon: Shield,
    title: 'No Account Needed',
    description: 'Compare instantly. No sign-up required.',
  },
]

export default function FeatureGrid() {
  return (
    <section
      id="features"
      className="relative snap-start min-h-screen bg-background overflow-hidden flex flex-col justify-center py-16 sm:py-24 md:py-28"
    >
      {/* Gradient mesh background */}
      <div className="absolute inset-0 gradient-mesh opacity-60" />

      <div className="relative z-10 container mx-auto px-4 max-w-6xl w-full">
        {/* Section header - editorial style */}
        <div className="mb-16">
          <span className="text-primary font-mono text-sm tracking-widest uppercase mb-4 block">
            Why RideCompare
          </span>
          <h2 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold text-foreground leading-[0.95] max-w-3xl">
            The fastest way to find your
            <span className="text-accent-gradient"> cheapest ride</span>
          </h2>
        </div>

        {/* Main features - asymmetric grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-16">
          {/* Large featured card */}
          <div className="lg:col-span-5 card-elevated float-hover rounded-2xl p-8 lg:p-10">
            <div className="flex items-start justify-between mb-6">
              <div className="w-14 h-14 bg-primary/10 border border-primary/20 rounded-xl flex items-center justify-center">
                <Zap className="w-7 h-7 text-primary" />
              </div>
              <div className="text-right">
                <div className="text-4xl font-bold text-foreground">{FEATURES[0].stat}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  {FEATURES[0].statLabel}
                </div>
              </div>
            </div>
            <h3 className="text-2xl font-bold text-foreground mb-3">{FEATURES[0].title}</h3>
            <p className="text-muted-foreground leading-relaxed">{FEATURES[0].description}</p>
          </div>

          {/* Two stacked cards */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            {FEATURES.slice(1).map(feature => {
              const Icon = feature.icon
              return (
                <div
                  key={feature.id}
                  className="card-interactive float-hover rounded-2xl p-6 lg:p-8 flex flex-col sm:flex-row sm:items-center gap-6"
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div className="w-12 h-12 bg-secondary/10 border border-secondary/20 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Icon className="w-6 h-6 text-secondary" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-foreground mb-1">
                        {feature.title}
                      </h3>
                      <p className="text-sm text-muted-foreground">{feature.description}</p>
                    </div>
                  </div>
                  <div className="text-left sm:text-right pl-16 sm:pl-0">
                    <div className="text-3xl font-bold text-foreground">{feature.stat}</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">
                      {feature.statLabel}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Secondary features - simple row */}
        <div className="border-t border-border/50 pt-12">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {SECONDARY_FEATURES.map((feature, index) => {
              const Icon = feature.icon
              return (
                <div key={index} className="flex items-start gap-4 group">
                  <div className="w-10 h-10 bg-muted/60 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors group-hover:bg-muted">
                    <Icon className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground mb-1">{feature.title}</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
