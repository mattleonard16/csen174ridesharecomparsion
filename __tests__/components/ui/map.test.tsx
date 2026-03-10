import { act, render, waitFor } from '@testing-library/react'
import { Map as MapComponent } from '@/components/ui/map'

const mockUseTheme = jest.fn()

jest.mock('next-themes', () => ({
  useTheme: () => mockUseTheme(),
}))

type Handler = () => void

class MockMapInstance {
  handlers = new globalThis.Map<string, Set<Handler>>()
  setStyle = jest.fn()
  resize = jest.fn()
  remove = jest.fn()
  isStyleLoaded = jest.fn(() => true)

  on(event: string, handler: Handler) {
    const existing = this.handlers.get(event) ?? new Set<Handler>()
    existing.add(handler)
    this.handlers.set(event, existing)
    return this
  }

  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler)
    return this
  }

  emit(event: string) {
    this.handlers.get(event)?.forEach(handler => handler())
  }
}

const mockMapConstructor = jest.fn()

jest.mock('maplibre-gl', () => ({
  __esModule: true,
  default: {
    Map: function MockMap(this: unknown) {
      return mockMapConstructor()
    },
  },
}))

describe('Map', () => {
  let mapInstance: MockMapInstance

  beforeEach(() => {
    jest.clearAllMocks()
    mapInstance = new MockMapInstance()
    mockMapConstructor.mockReturnValue(mapInstance)
    mockUseTheme.mockReturnValue({ resolvedTheme: 'dark' })
  })

  it('does not call setStyle before the initial style has loaded', () => {
    render(<MapComponent center={[-122.4, 37.7]} zoom={10} />)

    expect(mapInstance.setStyle).not.toHaveBeenCalled()
  })

  it('switches styles only after load and uses a full reload for theme changes', async () => {
    const { rerender } = render(<MapComponent center={[-122.4, 37.7]} zoom={10} />)

    await act(async () => {
      mapInstance.emit('load')
      mapInstance.emit('style.load')
    })

    expect(mapInstance.setStyle).not.toHaveBeenCalled()

    mockUseTheme.mockReturnValue({ resolvedTheme: 'light' })
    rerender(<MapComponent center={[-122.4, 37.7]} zoom={10} />)

    await waitFor(() => {
      expect(mapInstance.setStyle).toHaveBeenCalledWith(
        'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
        { diff: false }
      )
    })
  })
})
