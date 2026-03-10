type ScrollContainer = Window | HTMLElement

interface PendingSnapRestore {
  cancel: () => void
  originalSnapType: string
}

const pendingSnapRestores = new WeakMap<HTMLElement, PendingSnapRestore>()

/**
 * Walk up from `element` to find the nearest scrollable ancestor.
 * Falls back to `window` when no overflow container is found.
 */
export function getScrollContainer(element: HTMLElement | null): ScrollContainer {
  let current = element?.parentElement ?? null

  while (current) {
    const style = window.getComputedStyle(current)
    const canScrollY =
      (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      current.scrollHeight > current.clientHeight

    if (canScrollY) {
      return current
    }

    current = current.parentElement
  }

  return window
}

function getScrollTop(scrollContainer: ScrollContainer): number {
  if (scrollContainer === window) {
    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
  }

  return (scrollContainer as HTMLElement).scrollTop
}

function getContainerTop(scrollContainer: ScrollContainer): number {
  if (scrollContainer === window) {
    return 0
  }

  return (scrollContainer as HTMLElement).getBoundingClientRect().top
}

/**
 * Scroll to a section by ID, temporarily disabling scroll-snap to prevent
 * snap points from fighting the smooth scroll animation.
 *
 * Restores snap via `scrollend` listener with a timeout fallback.
 * Cleans up properly: whichever fires first cancels the other.
 */
export function scrollToSection(sectionId: string, scrollContainer: ScrollContainer): void {
  const target = document.getElementById(sectionId)
  if (!target) return

  const scrollHost = scrollContainer instanceof HTMLElement ? scrollContainer : null
  const existingRestore = scrollHost ? pendingSnapRestores.get(scrollHost) : null
  const originalSnapType =
    existingRestore?.originalSnapType ?? scrollHost?.style.scrollSnapType ?? ''
  existingRestore?.cancel()

  if (scrollHost) {
    scrollHost.style.scrollSnapType = 'none'
  }

  const scrollMarginTop = Number.parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0
  const targetTop =
    getScrollTop(scrollContainer) +
    target.getBoundingClientRect().top -
    getContainerTop(scrollContainer) -
    scrollMarginTop

  scrollContainer.scrollTo({
    top: Math.max(0, targetTop),
    behavior: 'smooth',
  })

  if (!scrollHost) {
    return
  }

  let fallbackTimer: ReturnType<typeof setTimeout> | null = null
  let restoreSnap = () => {}
  const pendingRestore: PendingSnapRestore = {
    cancel: () => {},
    originalSnapType,
  }

  const cleanupPendingRestore = () => {
    scrollHost.removeEventListener('scrollend', restoreSnap)
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer)
      fallbackTimer = null
    }

    if (pendingSnapRestores.get(scrollHost) === pendingRestore) {
      pendingSnapRestores.delete(scrollHost)
    }
  }

  pendingRestore.cancel = cleanupPendingRestore

  restoreSnap = () => {
    cleanupPendingRestore()
    scrollHost.style.scrollSnapType = originalSnapType
  }

  pendingSnapRestores.set(scrollHost, pendingRestore)
  scrollHost.addEventListener('scrollend', restoreSnap)
  fallbackTimer = setTimeout(restoreSnap, 1500)
}
