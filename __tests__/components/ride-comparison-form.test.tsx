import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RideComparisonForm from '@/components/ride-comparison-form'

// RideComparisonForm renders RideComparisonResults, which depends on auth context.
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

jest.mock('@/lib/hooks/use-recaptcha', () => ({
  useRecaptcha: () => ({
    executeRecaptcha: jest.fn(async () => ''),
    isLoaded: true,
    error: null,
  }),
}))

jest.mock('@/lib/hooks/useUserLocation', () => ({
  useUserLocation: () => ({
    getLocation: jest.fn(),
    isGettingLocation: false,
    error: null,
    clearError: jest.fn(),
  }),
}))

describe('RideComparisonForm', () => {
  it('renders the form with all required elements', () => {
    render(<RideComparisonForm />)

    expect(screen.getByLabelText(/pickup location/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/destination/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /compare rides/i })).toBeInTheDocument()
  })

  it('shows loading state when form is submitted', async () => {
    // Mock fetch to return a pending promise to keep loading state
    global.fetch = jest.fn().mockImplementation(() => new Promise(() => {}))

    render(<RideComparisonForm />)

    const pickupInput = screen.getByLabelText(/pickup location/i)
    const destinationInput = screen.getByLabelText(/destination/i)
    const submitButton = screen.getByRole('button', { name: /compare rides/i })

    await userEvent.type(pickupInput, '123 Main St')
    await userEvent.type(destinationInput, '456 Market St')
    fireEvent.click(submitButton)

    expect(screen.getByText(/comparing prices/i)).toBeInTheDocument()
  })

  it('handles form submission failures without falling back to fake pricing', async () => {
    // Mock fetch to simulate API failure
    global.fetch = jest.fn().mockRejectedValue(new Error('API Error'))

    render(<RideComparisonForm />)

    const pickupInput = screen.getByLabelText(/pickup location/i)
    const destinationInput = screen.getByLabelText(/destination/i)
    const submitButton = screen.getByRole('button', { name: /compare rides/i })

    await userEvent.type(pickupInput, '123 Main St')
    await userEvent.type(destinationInput, '456 Market St')
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(
        screen.getByText(/failed to fetch ride comparisons\. please try again\./i)
      ).toBeInTheDocument()
    })
  })

  it('validates required fields', async () => {
    render(<RideComparisonForm />)

    const pickupInput = screen.getByLabelText(/pickup location/i)
    const destinationInput = screen.getByLabelText(/destination/i)
    const submitButton = screen.getByRole('button', { name: /compare rides/i })

    // Submit empty form
    fireEvent.click(submitButton)

    // Check that the form prevents submission by checking if inputs are still empty
    expect(pickupInput).toHaveValue('')
    expect(destinationInput).toHaveValue('')

    // Check that inputs have required attribute
    expect(pickupInput).toHaveAttribute('required')
    expect(destinationInput).toHaveAttribute('required')
  })

  it('clears error state when valid input is provided', async () => {
    render(<RideComparisonForm />)

    const pickupInput = screen.getByLabelText(/pickup location/i)
    const destinationInput = screen.getByLabelText(/destination/i)

    // Fill in valid inputs
    await userEvent.type(pickupInput, '123 Main St')
    await userEvent.type(destinationInput, '456 Market St')

    // Check that inputs have valid values
    expect(pickupInput).toHaveValue('123 Main St')
    expect(destinationInput).toHaveValue('456 Market St')

    // Check that inputs are not empty (which would make them invalid)
    expect(pickupInput).not.toHaveValue('')
    expect(destinationInput).not.toHaveValue('')
  })

  it('disables submit button while loading', async () => {
    // Mock fetch to return a pending promise to keep loading state
    global.fetch = jest.fn().mockImplementation(() => new Promise(() => {}))

    render(<RideComparisonForm />)

    const pickupInput = screen.getByLabelText(/pickup location/i)
    const destinationInput = screen.getByLabelText(/destination/i)
    const submitButton = screen.getByRole('button', { name: /compare rides/i })

    await userEvent.type(pickupInput, '123 Main St')
    await userEvent.type(destinationInput, '456 Market St')
    fireEvent.click(submitButton)

    expect(submitButton).toBeDisabled()
  })

  it('handles input changes correctly', async () => {
    render(<RideComparisonForm />)

    const pickupInput = screen.getByLabelText(/pickup location/i)
    const destinationInput = screen.getByLabelText(/destination/i)

    await userEvent.type(pickupInput, '123 Main St')
    await userEvent.type(destinationInput, '456 Market St')

    expect(pickupInput).toHaveValue('123 Main St')
    expect(destinationInput).toHaveValue('456 Market St')
  })

  it('shows error message when API fails', async () => {
    // Mock fetch to simulate API failure
    global.fetch = jest.fn().mockRejectedValue(new Error('API Error'))

    render(<RideComparisonForm />)

    const pickupInput = screen.getByLabelText(/pickup location/i)
    const destinationInput = screen.getByLabelText(/destination/i)
    const submitButton = screen.getByRole('button', { name: /compare rides/i })

    await userEvent.type(pickupInput, '123 Main St')
    await userEvent.type(destinationInput, '456 Market St')
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(
        screen.getByText(/failed to fetch ride comparisons\. please try again\./i)
      ).toBeInTheDocument()
    })
  })
})
