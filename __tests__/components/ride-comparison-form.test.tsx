import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RideComparisonForm from '@/components/ride-comparison-form'

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () =>
    function DynamicStub() {
      return <div data-testid="route-map-stub" />
    },
}))

jest.mock('@/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useAuth: () => ({
    user: null,
    session: null,
    loading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
  }),
}))

jest.mock('@/components/ride-comparison-results', () => ({
  __esModule: true,
  default: ({
    results,
    routeAccuracy,
    routeWarning,
  }: {
    results: { uber: { price: string } }
    routeAccuracy?: string
    routeWarning?: string
  }) => (
    <div>
      <div>Results loaded: {results.uber.price}</div>
      <div>Route accuracy: {routeAccuracy ?? 'exact'}</div>
      {routeWarning ? <div>{routeWarning}</div> : null}
    </div>
  ),
}))

jest.mock('@/components/route-header', () => ({
  __esModule: true,
  default: () => <div>Route Header</div>,
}))

jest.mock('@/components/airport-selector', () => ({
  AirportSelector: () => null,
}))

jest.mock('@/components/location-input', () => ({
  LocationInput: ({
    id,
    label,
    value,
    onChange,
    headerAction,
  }: {
    id: string
    label: string
    value: string
    onChange: (value: string) => void
    headerAction?: ReactNode
  }) => (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-label={label}
        value={value}
        required
        onChange={e => onChange(e.target.value)}
      />
      {headerAction}
    </div>
  ),
}))

jest.mock('@/lib/hooks/use-recaptcha', () => ({
  useRecaptcha: () => ({
    executeRecaptcha: jest.fn().mockResolvedValue('recaptcha-token'),
    isLoaded: true,
    error: null,
  }),
}))

jest.mock('@/lib/hooks/useUserLocation', () => ({
  useUserLocation: () => ({
    getLocation: jest.fn(),
    isGettingLocation: false,
    error: null,
  }),
}))

describe('RideComparisonForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.localStorage.clear()
  })

  it('renders the form with all required elements', () => {
    render(<RideComparisonForm />)

    expect(screen.getByLabelText(/pickup location/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/destination/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /compare rides/i })).toBeInTheDocument()
  })

  it('shows loading state when form is submitted', async () => {
    global.fetch = jest.fn().mockImplementation(() => new Promise(() => {}))

    render(<RideComparisonForm />)

    await userEvent.type(screen.getByLabelText(/pickup location/i), '123 Main St')
    await userEvent.type(screen.getByLabelText(/destination/i), '456 Market St')
    fireEvent.click(screen.getByRole('button', { name: /compare rides/i }))

    expect(screen.getByText(/comparing prices/i)).toBeInTheDocument()
  })

  it('keeps the replacement request loading after aborting the previous auto-submit request', async () => {
    let resolveSecondRequest: ((value: unknown) => void) | undefined

    global.fetch = jest
      .fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal | undefined

        return new Promise((_, reject) => {
          signal?.addEventListener('abort', () => {
            const abortError = new Error('Aborted')
            abortError.name = 'AbortError'
            reject(abortError)
          })
        })
      })
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveSecondRequest = resolve
          })
      )

    const onRouteProcessed = jest.fn()
    const { rerender } = render(
      <RideComparisonForm
        selectedRoute={{
          pickup: 'First Pickup',
          destination: 'First Destination',
        }}
        onRouteProcessed={onRouteProcessed}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/comparing prices/i)).toBeInTheDocument()
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    rerender(
      <RideComparisonForm
        selectedRoute={{
          pickup: 'Second Pickup',
          destination: 'Second Destination',
        }}
        onRouteProcessed={onRouteProcessed}
      />
    )

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2)
      expect(screen.getByText(/comparing prices/i)).toBeInTheDocument()
    })

    rerender(
      <RideComparisonForm
        selectedRoute={{
          pickup: 'Second Pickup',
          destination: 'Second Destination',
        }}
        onRouteProcessed={onRouteProcessed}
      />
    )

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    resolveSecondRequest?.({
      ok: true,
      json: async () => ({
        routeId: 'route-replacement',
        comparisons: {
          uber: {
            price: '$17.00',
            waitTime: '3 min',
            driversNearby: 4,
            service: 'UberX',
          },
        },
        insights: 'Second request won.',
        pickupCoords: [-122.4, 37.7],
        destinationCoords: [-122.3, 37.8],
        routeAccuracy: 'exact',
      }),
    })

    await waitFor(() => {
      expect(screen.getByText('Results loaded: $17.00')).toBeInTheDocument()
    })

    expect(onRouteProcessed).toHaveBeenCalled()
  })

  it('shows server results on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        routeId: 'route-123',
        comparisons: {
          uber: {
            price: '$21.00',
            waitTime: '4 min',
            driversNearby: 5,
            service: 'UberX',
          },
        },
        insights: 'Take Uber.',
        pickupCoords: [-122.4, 37.7],
        destinationCoords: [-122.3, 37.8],
        routeAccuracy: 'exact',
      }),
    })

    render(<RideComparisonForm />)

    await userEvent.type(screen.getByLabelText(/pickup location/i), '123 Main St')
    await userEvent.type(screen.getByLabelText(/destination/i), '456 Market St')
    fireEvent.click(screen.getByRole('button', { name: /compare rides/i }))

    await waitFor(() => {
      expect(screen.getByText('Results loaded: $21.00')).toBeInTheDocument()
    })

    expect(screen.getByText('Route accuracy: exact')).toBeInTheDocument()
  })

  it('shows degraded compare results with an estimated route warning', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        routeId: 'route-789',
        comparisons: {
          uber: {
            price: '$19.50',
            waitTime: '5 min',
            driversNearby: 4,
            service: 'UberX',
          },
        },
        insights: 'Estimated route comparison is still available.',
        pickupCoords: [-122.4, 37.7],
        destinationCoords: [-122.3, 37.8],
        routeAccuracy: 'estimated',
        routeWarning:
          'Prices are based on estimated route metrics because live routing is temporarily unavailable.',
      }),
    })

    render(<RideComparisonForm />)

    await userEvent.type(screen.getByLabelText(/pickup location/i), '123 Main St')
    await userEvent.type(screen.getByLabelText(/destination/i), '456 Market St')
    fireEvent.click(screen.getByRole('button', { name: /compare rides/i }))

    await waitFor(() => {
      expect(screen.getByText('Results loaded: $19.50')).toBeInTheDocument()
    })

    expect(screen.getByText('Route accuracy: estimated')).toBeInTheDocument()
    expect(screen.getByText(/estimated route metrics/i)).toBeInTheDocument()
  })

  it('shows an error and never falls back to simulated prices when compare fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('API Error'))

    render(<RideComparisonForm />)

    await userEvent.type(screen.getByLabelText(/pickup location/i), '123 Main St')
    await userEvent.type(screen.getByLabelText(/destination/i), '456 Market St')
    fireEvent.click(screen.getByRole('button', { name: /compare rides/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/failed to fetch ride comparisons\. please try again\./i)
      ).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.queryByText(/simulated data/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Results loaded:/i)).not.toBeInTheDocument()
  })

  it('retries the request from the error state', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('API Error'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          routeId: 'route-456',
          comparisons: {
            uber: {
              price: '$18.00',
              waitTime: '3 min',
              driversNearby: 6,
              service: 'UberX',
            },
          },
          insights: 'Retry worked.',
          pickupCoords: [-122.4, 37.7],
          destinationCoords: [-122.3, 37.8],
          routeAccuracy: 'exact',
        }),
      })

    render(<RideComparisonForm />)

    await userEvent.type(screen.getByLabelText(/pickup location/i), '123 Main St')
    await userEvent.type(screen.getByLabelText(/destination/i), '456 Market St')
    fireEvent.click(screen.getByRole('button', { name: /compare rides/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => {
      expect(screen.getByText('Results loaded: $18.00')).toBeInTheDocument()
    })

    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('shows address-specific validation copy for geocode failures', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: 'We could not find one of those addresses. Please enter a more specific location.',
        code: 'ADDRESS_NOT_FOUND',
      }),
    })

    render(<RideComparisonForm />)

    await userEvent.type(screen.getByLabelText(/pickup location/i), 'Unknown Place')
    await userEvent.type(screen.getByLabelText(/destination/i), '456 Market St')
    fireEvent.click(screen.getByRole('button', { name: /compare rides/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/we could not find one of those addresses/i)
      ).toBeInTheDocument()
    })
  })
})
