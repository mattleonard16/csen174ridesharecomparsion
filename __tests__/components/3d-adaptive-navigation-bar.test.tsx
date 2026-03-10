import { render } from '@testing-library/react'
import { PillBase } from '@/components/ui/3d-adaptive-navigation-bar'

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

jest.mock('next-themes', () => ({
  useTheme: () => ({
    resolvedTheme: 'light',
  }),
}))

jest.mock('@/lib/hooks/useIsMounted', () => ({
  useIsMounted: () => true,
}))

jest.mock('framer-motion', () => {
  const React = require('react') as typeof import('react')
  const sanitizeMotionProps = (
    props: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }
  ) => {
    const {
      animate: _animate,
      exit: _exit,
      initial: _initial,
      transition: _transition,
      ...domProps
    } = props as React.HTMLAttributes<HTMLElement> & {
      animate?: unknown
      exit?: unknown
      initial?: unknown
      transition?: unknown
      children?: React.ReactNode
    }

    return domProps
  }

  const createMotionComponent = (tag: string) => {
    const MotionComponent = React.forwardRef<
      HTMLElement,
      React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }
    >(({ children, ...props }, ref) =>
      React.createElement(tag, { ...sanitizeMotionProps(props), ref }, children)
    )
    MotionComponent.displayName = `Motion(${tag})`

    return MotionComponent
  }

  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) => createMotionComponent(tag),
    }
  )

  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useSpring: () => ({
      set: jest.fn(),
    }),
  }
})

type RectOptions = {
  top: number
  height?: number
  left?: number
  width?: number
}

function createRect({ top, height = 600, left = 0, width = 800 }: RectOptions): DOMRect {
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

describe('PillBase scroll cleanup', () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame
  const originalCancelAnimationFrame = window.cancelAnimationFrame

  beforeEach(() => {
    document.body.innerHTML = ''

    const scrollContainer = document.createElement('main')
    scrollContainer.style.overflowY = 'auto'
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 600,
    })
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 2400,
    })

    ;['home', 'routes', 'features', 'compare'].forEach((id, index) => {
      const section = document.createElement('section')
      section.id = id
      section.getBoundingClientRect = jest.fn(() =>
        createRect({
          top: index * 600,
        })
      )
      scrollContainer.appendChild(section)
    })

    document.body.appendChild(scrollContainer)
  })

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
    jest.restoreAllMocks()
  })

  it('cancels queued animation frames when the scroll effect cleans up', () => {
    const requestAnimationFrameSpy = jest.fn(() => 42)
    const cancelAnimationFrameSpy = jest.fn()

    window.requestAnimationFrame = requestAnimationFrameSpy as typeof window.requestAnimationFrame
    window.cancelAnimationFrame = cancelAnimationFrameSpy as typeof window.cancelAnimationFrame

    const { unmount } = render(<PillBase />)
    const scrollContainer = document.getElementById('home')?.parentElement

    expect(scrollContainer).not.toBeNull()

    scrollContainer?.dispatchEvent(new Event('scroll'))
    expect(requestAnimationFrameSpy).toHaveBeenCalled()

    unmount()

    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(42)
  })
})
