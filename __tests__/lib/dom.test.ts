import { scrollToSection } from '@/lib/dom'

type RectOptions = {
  top: number
  height?: number
  left?: number
  width?: number
}

function createRect({ top, height = 200, left = 0, width = 800 }: RectOptions): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect
}

describe('scrollToSection', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  function setupScrollableDom() {
    const container = document.createElement('div')
    container.style.overflowY = 'auto'
    container.style.scrollSnapType = 'y mandatory'
    container.scrollTo = jest.fn()
    container.getBoundingClientRect = jest.fn(() => createRect({ top: 40, height: 600 }))
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      value: 120,
      writable: true,
    })
    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      value: 600,
    })
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      value: 1800,
    })

    const target = document.createElement('section')
    target.id = 'compare'
    target.style.scrollMarginTop = '80px'
    target.getBoundingClientRect = jest.fn(() => createRect({ top: 500, height: 480 }))

    container.appendChild(target)
    document.body.appendChild(container)

    return { container, target }
  }

  it('uses container-relative geometry and scroll margin when computing the destination', () => {
    const { container } = setupScrollableDom()

    scrollToSection('compare', container)

    expect(container.scrollTo).toHaveBeenCalledWith({
      top: 500,
      behavior: 'smooth',
    })
  })

  it('keeps snap disabled until the latest pending scroll restore completes', () => {
    const { container } = setupScrollableDom()

    scrollToSection('compare', container)
    jest.advanceTimersByTime(1000)

    scrollToSection('compare', container)
    jest.advanceTimersByTime(600)

    expect(container.style.scrollSnapType).toBe('none')

    jest.advanceTimersByTime(900)

    expect(container.style.scrollSnapType).toBe('y mandatory')
  })
})
