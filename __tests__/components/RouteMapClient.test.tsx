import { render, screen, waitFor } from '@testing-library/react'
import RouteMapClient from '@/components/RouteMapClient'

const fitBounds = jest.fn()

jest.mock('maplibre-gl', () => ({
  __esModule: true,
  default: {
    LngLatBounds: class {
      extend() {
        return this
      }
    },
  },
}))

jest.mock('@/components/ui/map', () => ({
  Map: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MapMarker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MarkerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MapRoute: () => <div data-testid="map-route" />,
  MapControls: () => <div />,
  useMap: () => ({
    map: { fitBounds },
    isLoaded: true,
  }),
}))

describe('RouteMapClient', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows an explicit degraded routing message when OSRM fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('OSRM down'))

    render(<RouteMapClient pickup={[-122.4, 37.7]} destination={[-122.3, 37.8]} />)

    await waitFor(() => {
      expect(screen.getByText(/live routing is temporarily unavailable/i)).toBeInTheDocument()
    })
  })
})
