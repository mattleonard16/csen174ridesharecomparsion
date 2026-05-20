import { render, screen, waitFor } from '@testing-library/react'
import RideComparisonResults from '@/components/ride-comparison-results'

// Mock fetch to simulate AI insights failure (so rule-based fallback renders)
beforeEach(() => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network error'))
})
afterEach(() => {
  jest.restoreAllMocks()
})

// Mock the auth context
jest.mock('@/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useAuth: () => ({
    user: null,
    session: null,
    loading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
  }),
}))

describe('RideComparisonResults', () => {
  const mockResults = {
    uber: {
      price: '$25.50',
      waitTime: '5 min',
      driversNearby: 4,
      service: 'UberX',
    },
    lyft: {
      price: '$23.75',
      waitTime: '6 min',
      driversNearby: 3,
      service: 'Lyft Standard',
    },
    taxi: {
      price: '$30.00',
      waitTime: '8 min',
      driversNearby: 2,
      service: 'Yellow Cab',
    },
  }

  const mockInsights =
    'Based on price and wait time, Lyft appears to be your best option for this trip.'

  it('renders the results with all ride services', () => {
    render(<RideComparisonResults results={mockResults} insights={mockInsights} />)

    expect(screen.getByRole('heading', { name: /uber/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /lyft/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /taxi/i })).toBeInTheDocument()
  })

  it('displays the correct pricing information', () => {
    render(<RideComparisonResults results={mockResults} insights={mockInsights} />)

    expect(screen.getByText('$25.50')).toBeInTheDocument()
    expect(screen.getAllByText('$23.75')).toHaveLength(2) // Summary and Lyft card
    expect(screen.getByText('$30.00')).toBeInTheDocument()
  })

  it('shows the insights message as fallback when AI fails', async () => {
    render(
      <RideComparisonResults
        results={mockResults}
        insights={mockInsights}
        pickup="SFO"
        destination="Union Square"
      />
    )

    await waitFor(() => {
      expect(screen.getByText(mockInsights)).toBeInTheDocument()
    })
  })

  it('displays wait times and driver availability', () => {
    render(<RideComparisonResults results={mockResults} insights={mockInsights} />)

    // Check wait times - use getAllByText since there are multiple instances
    expect(screen.getAllByText('5 min')).toHaveLength(2) // Summary and Uber card
    expect(screen.getByText('6 min')).toBeInTheDocument() // Lyft card
    expect(screen.getByText('8 min')).toBeInTheDocument() // Taxi card

    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getAllByText(/nearby drivers/i)).toHaveLength(3)
  })

  it('displays service icons correctly', () => {
    render(<RideComparisonResults results={mockResults} insights={mockInsights} />)

    // Check for service names (rendered in uppercase headers)
    expect(screen.getByRole('heading', { name: /uber/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /lyft/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /taxi/i })).toBeInTheDocument()
  })

  it('formats prices consistently', () => {
    render(<RideComparisonResults results={mockResults} insights={mockInsights} />)

    const prices = screen.getAllByText(/\$\d+\.\d{2}/)
    // Summary section + 3 service cards + 3 confidence-band "± $X" spans
    expect(prices).toHaveLength(7)
  })

  describe('confidence band', () => {
    function resultsWith(confidence: number | undefined) {
      return {
        ...mockResults,
        uber: { ...mockResults.uber, confidence, price: '$25.50' },
        lyft: { ...mockResults.lyft, confidence, price: '$23.75' },
        taxi: { ...mockResults.taxi, confidence, price: '$30.00' },
      }
    }

    it('renders "High confidence" for confidence >= 0.8', () => {
      render(<RideComparisonResults results={resultsWith(0.85)} insights={mockInsights} />)
      expect(screen.getAllByText(/High confidence/)).toHaveLength(3)
    })

    it('renders "Medium confidence" for confidence in [0.65, 0.8)', () => {
      render(<RideComparisonResults results={resultsWith(0.7)} insights={mockInsights} />)
      expect(screen.getAllByText(/Medium confidence/)).toHaveLength(3)
    })

    it('renders "Low confidence" for confidence < 0.65', () => {
      render(<RideComparisonResults results={resultsWith(0.55)} insights={mockInsights} />)
      expect(screen.getAllByText(/Low confidence/)).toHaveLength(3)
    })

    it('falls back to Medium (default 0.7) when confidence is undefined', () => {
      render(<RideComparisonResults results={resultsWith(undefined)} insights={mockInsights} />)
      expect(screen.getAllByText(/Medium confidence/)).toHaveLength(3)
    })

    it('clamps the ± band to a minimum of $1', () => {
      const cheap = {
        uber: { ...mockResults.uber, price: '$5.00', confidence: 0.85 },
        lyft: { ...mockResults.lyft, price: '$5.00', confidence: 0.85 },
        taxi: { ...mockResults.taxi, price: '$5.00', confidence: 0.85 },
      }
      render(<RideComparisonResults results={cheap} insights={mockInsights} />)
      // (1 - 0.85) * 0.5 * 5 = 0.375 → floored to $1.00
      expect(screen.getAllByText(/± \$1\.00 estimate range/)).toHaveLength(3)
    })
  })

  it('handles edge case with zero drivers nearby', () => {
    const edgeCaseResults = {
      ...mockResults,
      uber: {
        ...mockResults.uber,
        driversNearby: 0,
      },
    }

    render(<RideComparisonResults results={edgeCaseResults} insights={mockInsights} />)

    expect(screen.getByText('0')).toBeInTheDocument() // Driver count for Uber
    expect(screen.getAllByText(/nearby drivers/i)).toHaveLength(3)
  })
})
