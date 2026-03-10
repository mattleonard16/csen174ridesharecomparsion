'use client'

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useIsMounted } from '@/lib/hooks/useIsMounted'

import { motion, useSpring, AnimatePresence } from 'framer-motion'
import { getScrollContainer, scrollToSection } from '@/lib/dom'

interface NavItem {
  label: string

  id: string
}

const COLLAPSED_WIDTH = 140
const EXPANDED_WIDTH = 580

/**

 * 3D Adaptive Navigation Pill

 * Smart navigation with scroll detection and hover expansion

 */

export const PillBase: React.FC = () => {
  const pathname = usePathname()
  const [activeSection, setActiveSection] = useState('home')

  const [expanded, setExpanded] = useState(false)
  const [expandedWidth, setExpandedWidth] = useState(EXPANDED_WIDTH)

  const [isTransitioning, setIsTransitioning] = useState(false)

  const navRef = useRef<HTMLElement>(null)

  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { resolvedTheme } = useTheme()
  const mounted = useIsMounted()
  const isDark = mounted && resolvedTheme === 'dark'

  const navColors = useMemo(
    () => ({
      activeText: isDark ? '#f0ece0' : '#1a1a1a',
      inactiveText: isDark ? '#9a9a9a' : '#656565',
      hoverText: isDark ? '#d0ccc0' : '#3a3a3a',
    }),
    [isDark]
  )

  const pillBackground = isDark
    ? `linear-gradient(135deg,
        #1e2433 0%, #1c2230 15%, #1a2030 30%,
        #181e2d 45%, #161c2a 60%, #141a27 75%,
        #121824 90%, #131925 100%)`
    : `linear-gradient(135deg,
        #fffdf9 0%, #fdfaf5 15%, #faf7f0 30%,
        #f7f4eb 45%, #f4f1e6 60%, #f1eee1 75%,
        #eeeadc 90%, #f0ece0 100%)`

  const navItems: NavItem[] = useMemo(
    () => [
      { label: 'Home', id: 'home' },
      { label: 'Routes', id: 'routes' },
      { label: 'Features', id: 'features' },
      { label: 'Compare', id: 'compare' },
    ],
    []
  )

  // Spring animations for smooth motion

  const pillWidth = useSpring(COLLAPSED_WIDTH, { stiffness: 220, damping: 25, mass: 1 })

  const expandNav = useCallback(() => {
    setExpanded(true)
    pillWidth.set(expandedWidth)

    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
    }
  }, [expandedWidth, pillWidth])

  const collapseNav = useCallback(() => {
    setExpanded(false)
    pillWidth.set(COLLAPSED_WIDTH)
  }, [pillWidth])

  const scheduleCollapse = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
    }

    hoverTimeoutRef.current = setTimeout(() => {
      collapseNav()
    }, 600)
  }, [collapseNav])

  // Cleanup hover timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    const updateExpandedWidth = () => {
      setExpandedWidth(Math.max(COLLAPSED_WIDTH, Math.min(EXPANDED_WIDTH, window.innerWidth - 32)))
    }

    updateExpandedWidth()
    window.addEventListener('resize', updateExpandedWidth)

    return () => window.removeEventListener('resize', updateExpandedWidth)
  }, [])

  useEffect(() => {
    if (expanded) {
      pillWidth.set(expandedWidth)
    }
  }, [expanded, expandedWidth, pillWidth])

  // Scroll detection to update active section
  useEffect(() => {
    if (pathname !== '/') return

    const firstSection = navItems
      .map(item => document.getElementById(item.id))
      .find(Boolean) as HTMLElement | null
    const scrollContainer = getScrollContainer(firstSection)

    let rafId: number | null = null

    const updateActiveSection = () => {
      rafId = null

      const sections = navItems
        .map(item => {
          const element = document.getElementById(item.id)
          if (element) {
            const rect = element.getBoundingClientRect()
            return {
              id: item.id,
              top: rect.top,
              bottom: rect.bottom,
              center: rect.top + rect.height / 2,
            }
          }
          return null
        })
        .filter(Boolean) as Array<{ id: string; top: number; bottom: number; center: number }>

      const viewportCenter =
        scrollContainer === window
          ? window.innerHeight / 2
          : (scrollContainer as HTMLElement).clientHeight / 2

      // Find the section closest to viewport center
      if (sections.length === 0) return

      const closestSection = sections.reduce((prev, curr) => {
        const prevDistance = Math.abs(prev.center - viewportCenter)
        const currDistance = Math.abs(curr.center - viewportCenter)
        return currDistance < prevDistance ? curr : prev
      })

      if (
        closestSection &&
        closestSection.top < viewportCenter &&
        closestSection.bottom > viewportCenter
      ) {
        setActiveSection(closestSection.id)
      }
    }

    const handleScroll = () => {
      if (rafId === null) {
        rafId = requestAnimationFrame(updateActiveSection)
      }
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    updateActiveSection() // Initial check

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [navItems, pathname])

  useEffect(() => {
    if (!expanded) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) {
        collapseNav()
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        collapseNav()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [collapseNav, expanded])

  // Handle hover expansion

  const handleMouseEnter = () => {
    expandNav()
  }

  const handleMouseLeave = () => {
    scheduleCollapse()
  }

  const handleSectionClick = (sectionId: string) => {
    // Trigger transition state

    setIsTransitioning(true)

    setActiveSection(sectionId)

    // Scroll to section — use shared helper that disables snap during scroll
    const firstSection = navItems
      .map(item => document.getElementById(item.id))
      .find(Boolean) as HTMLElement | null
    const scrollContainer = getScrollContainer(firstSection)

    scrollToSection(sectionId, scrollContainer)

    // Collapse the pill after selection
    scheduleCollapse()

    // Reset transition state after animation completes

    setTimeout(() => {
      setIsTransitioning(false)
    }, 400)
  }

  const activeItem = navItems.find(item => item.id === activeSection)

  if (pathname !== '/') {
    return null
  }

  return (
    <motion.nav
      ref={navRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="relative rounded-full"
      style={{
        width: pillWidth,

        height: '56px',

        background: pillBackground,

        boxShadow: expanded
          ? `

            0 2px 4px rgba(0, 0, 0, 0.08),

            0 6px 12px rgba(0, 0, 0, 0.12),

            0 12px 24px rgba(0, 0, 0, 0.14),

            0 24px 48px rgba(0, 0, 0, 0.10),

            inset 0 2px 2px rgba(255, 255, 255, 0.8),

            inset 0 -3px 8px rgba(0, 0, 0, 0.12),

            inset 3px 3px 8px rgba(0, 0, 0, 0.10),

            inset -3px 3px 8px rgba(0, 0, 0, 0.09),

            inset 0 -1px 2px rgba(0, 0, 0, 0.08)

          `
          : isTransitioning
            ? `

            0 3px 6px rgba(0, 0, 0, 0.10),

            0 8px 16px rgba(0, 0, 0, 0.08),

            0 16px 32px rgba(0, 0, 0, 0.06),

            0 1px 2px rgba(0, 0, 0, 0.10),

            inset 0 2px 1px rgba(255, 255, 255, 0.85),

            inset 0 -2px 6px rgba(0, 0, 0, 0.08),

            inset 2px 2px 8px rgba(0, 0, 0, 0.06),

            inset -2px 2px 8px rgba(0, 0, 0, 0.05),

            inset 0 0 1px rgba(0, 0, 0, 0.12),

            inset 0 0 20px rgba(255, 255, 255, 0.15)

          `
            : `

            0 3px 6px rgba(0, 0, 0, 0.12),

            0 8px 16px rgba(0, 0, 0, 0.10),

            0 16px 32px rgba(0, 0, 0, 0.08),

            0 1px 2px rgba(0, 0, 0, 0.12),

            inset 0 2px 1px rgba(255, 255, 255, 0.7),

            inset 0 -2px 6px rgba(0, 0, 0, 0.10),

            inset 2px 2px 8px rgba(0, 0, 0, 0.08),

            inset -2px 2px 8px rgba(0, 0, 0, 0.07),

            inset 0 0 1px rgba(0, 0, 0, 0.15)

          `,

        overflow: 'hidden',

        transition: 'box-shadow 0.3s ease-out',
      }}
    >
      {/* Primary top edge ridge - ultra bright */}

      <div
        className="absolute inset-x-0 top-0 rounded-t-full pointer-events-none"
        style={{
          height: '2px',

          background:
            'linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.95) 5%, rgba(255, 255, 255, 1) 15%, rgba(255, 255, 255, 1) 85%, rgba(255, 255, 255, 0.95) 95%, rgba(255, 255, 255, 0) 100%)',

          filter: 'blur(0.3px)',
        }}
      />

      {/* Top hemisphere light catch */}

      <div
        className="absolute inset-x-0 top-0 rounded-full pointer-events-none"
        style={{
          height: '55%',

          background:
            'linear-gradient(180deg, rgba(255, 255, 255, 0.45) 0%, rgba(255, 255, 255, 0.25) 30%, rgba(255, 255, 255, 0.10) 60%, rgba(255, 255, 255, 0) 100%)',
        }}
      />

      {/* Directional light - top left */}

      <div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background:
            'linear-gradient(135deg, rgba(255, 255, 255, 0.40) 0%, rgba(255, 255, 255, 0.20) 20%, rgba(255, 255, 255, 0.08) 40%, rgba(255, 255, 255, 0) 65%)',
        }}
      />

      {/* Premium gloss reflection - main */}

      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          left: expanded ? '18%' : '15%',

          top: '16%',

          width: expanded ? '140px' : '60px',

          height: '14px',

          background:
            'radial-gradient(ellipse at center, rgba(255, 255, 255, 0.70) 0%, rgba(255, 255, 255, 0.35) 40%, rgba(255, 255, 255, 0.10) 70%, rgba(255, 255, 255, 0) 100%)',

          filter: 'blur(4px)',

          transform: 'rotate(-12deg)',

          transition: 'all 0.3s ease',
        }}
      />

      {/* Secondary gloss accent - only show when expanded */}

      {expanded && (
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            right: '22%',

            top: '20%',

            width: '80px',

            height: '10px',

            background:
              'radial-gradient(ellipse at center, rgba(255, 255, 255, 0.50) 0%, rgba(255, 255, 255, 0.15) 60%, rgba(255, 255, 255, 0) 100%)',

            filter: 'blur(3px)',

            transform: 'rotate(8deg)',
          }}
        />
      )}

      {/* Left edge illumination - only show when expanded */}

      {expanded && (
        <div
          className="absolute inset-y-0 left-0 rounded-l-full pointer-events-none"
          style={{
            width: '35%',

            background:
              'linear-gradient(90deg, rgba(255, 255, 255, 0.20) 0%, rgba(255, 255, 255, 0.10) 40%, rgba(255, 255, 255, 0.03) 70%, rgba(255, 255, 255, 0) 100%)',
          }}
        />
      )}

      {/* Right edge shadow - only show when expanded */}

      {expanded && (
        <div
          className="absolute inset-y-0 right-0 rounded-r-full pointer-events-none"
          style={{
            width: '35%',

            background:
              'linear-gradient(270deg, rgba(0, 0, 0, 0.10) 0%, rgba(0, 0, 0, 0.05) 40%, rgba(0, 0, 0, 0.02) 70%, rgba(0, 0, 0, 0) 100%)',
          }}
        />
      )}

      {/* Bottom curvature - deep shadow */}

      <div
        className="absolute inset-x-0 bottom-0 rounded-b-full pointer-events-none"
        style={{
          height: '50%',

          background:
            'linear-gradient(0deg, rgba(0, 0, 0, 0.14) 0%, rgba(0, 0, 0, 0.08) 25%, rgba(0, 0, 0, 0.03) 50%, rgba(0, 0, 0, 0) 100%)',
        }}
      />

      {/* Bottom edge contact shadow */}

      <div
        className="absolute inset-x-0 bottom-0 rounded-b-full pointer-events-none"
        style={{
          height: '20%',

          background: 'linear-gradient(0deg, rgba(0, 0, 0, 0.20) 0%, rgba(0, 0, 0, 0) 100%)',

          filter: 'blur(2px)',
        }}
      />

      {/* Inner diffuse glow */}

      <div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          boxShadow: 'inset 0 0 40px rgba(255, 255, 255, 0.22)',

          opacity: 0.7,
        }}
      />

      {/* Micro edge definition */}

      <div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          boxShadow: 'inset 0 0 0 0.5px rgba(0, 0, 0, 0.10)',
        }}
      />

      {/* Navigation items container */}

      <div
        className="relative z-10 h-full flex items-center justify-center px-6"
        style={{
          fontFamily:
            'var(--font-dm-sans), -apple-system, BlinkMacSystemFont, "SF Pro", Poppins, sans-serif',
        }}
      >
        {/* Collapsed state - show only active section with smooth text transitions */}
        {!expanded && (
          <div className="flex items-center relative">
            <AnimatePresence mode="wait">
              {activeItem && (
                <motion.button
                  key={activeItem.id}
                  type="button"
                  initial={false}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{
                    duration: 0.25,
                    ease: [0.4, 0.0, 0.2, 1],
                  }}
                  onClick={expandNav}
                  aria-label="Open section navigation"
                  aria-expanded={expanded}
                  style={{
                    fontSize: '15.5px',
                    fontWeight: 680,
                    color: navColors.activeText,
                    letterSpacing: '0.45px',
                    whiteSpace: 'nowrap',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '10px 16px',
                    fontFamily:
                      'var(--font-dm-sans), -apple-system, BlinkMacSystemFont, "SF Pro Display", Poppins, sans-serif',
                    WebkitFontSmoothing: 'antialiased',
                    MozOsxFontSmoothing: 'grayscale',
                    textShadow: isDark
                      ? `
                        0 1px 0 rgba(0, 0, 0, 0.6),
                        0 -1px 0 rgba(255, 255, 255, 0.1),
                        1px 1px 0 rgba(0, 0, 0, 0.3),
                        -1px 1px 0 rgba(0, 0, 0, 0.25)
                      `
                      : `
                        0 1px 0 rgba(0, 0, 0, 0.35),
                        0 -1px 0 rgba(255, 255, 255, 0.8),
                        1px 1px 0 rgba(0, 0, 0, 0.18),
                        -1px 1px 0 rgba(0, 0, 0, 0.15)
                      `,
                  }}
                >
                  {activeItem.label}
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Expanded state - show all sections with stagger */}

        {expanded && (
          <div className="flex items-center justify-evenly w-full">
            {navItems.map((item, index) => {
              const isActive = item.id === activeSection

              return (
                <motion.button
                  key={item.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{
                    delay: index * 0.08,

                    duration: 0.25,

                    ease: 'easeOut',
                  }}
                  onClick={() => handleSectionClick(item.id)}
                  className="relative cursor-pointer transition-all duration-200"
                  style={{
                    fontSize: isActive ? '15.5px' : '15px',

                    fontWeight: isActive ? 680 : 510,

                    color: isActive ? navColors.activeText : navColors.inactiveText,

                    textDecoration: 'none',

                    letterSpacing: '0.45px',

                    background: 'transparent',

                    border: 'none',

                    padding: '10px 16px',

                    outline: 'none',

                    whiteSpace: 'nowrap',

                    fontFamily:
                      'var(--font-dm-sans), -apple-system, BlinkMacSystemFont, "SF Pro Display", Poppins, sans-serif',

                    WebkitFontSmoothing: 'antialiased',

                    MozOsxFontSmoothing: 'grayscale',

                    transform: isActive ? 'translateY(-1.5px)' : 'translateY(0)',

                    textShadow: isActive
                      ? isDark
                        ? `
                          0 1px 0 rgba(0, 0, 0, 0.6),
                          0 -1px 0 rgba(255, 255, 255, 0.1),
                          1px 1px 0 rgba(0, 0, 0, 0.3),
                          -1px 1px 0 rgba(0, 0, 0, 0.25)
                        `
                        : `

                        0 1px 0 rgba(0, 0, 0, 0.35),

                        0 -1px 0 rgba(255, 255, 255, 0.8),

                        1px 1px 0 rgba(0, 0, 0, 0.18),

                        -1px 1px 0 rgba(0, 0, 0, 0.15)

                      `
                      : isDark
                        ? `
                          0 1px 0 rgba(0, 0, 0, 0.4),
                          0 -1px 0 rgba(255, 255, 255, 0.05),
                          1px 1px 0 rgba(0, 0, 0, 0.2),
                          -1px 1px 0 rgba(0, 0, 0, 0.15)
                        `
                        : `

                        0 1px 0 rgba(0, 0, 0, 0.22),

                        0 -1px 0 rgba(255, 255, 255, 0.65),

                        1px 1px 0 rgba(0, 0, 0, 0.12),

                        -1px 1px 0 rgba(0, 0, 0, 0.10)

                      `,
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      e.currentTarget.style.color = navColors.hoverText

                      e.currentTarget.style.transform = 'translateY(-0.5px)'

                      e.currentTarget.style.textShadow = isDark
                        ? `
                          0 1px 0 rgba(0, 0, 0, 0.5),
                          0 -1px 0 rgba(255, 255, 255, 0.08),
                          1px 1px 0 rgba(0, 0, 0, 0.25),
                          -1px 1px 0 rgba(0, 0, 0, 0.2)
                        `
                        : `
                          0 1px 0 rgba(0, 0, 0, 0.28),
                          0 -1px 0 rgba(255, 255, 255, 0.72),
                          1px 1px 0 rgba(0, 0, 0, 0.15),
                          -1px 1px 0 rgba(0, 0, 0, 0.12)
                        `
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      e.currentTarget.style.color = navColors.inactiveText

                      e.currentTarget.style.transform = 'translateY(0)'

                      e.currentTarget.style.textShadow = isDark
                        ? `
                          0 1px 0 rgba(0, 0, 0, 0.4),
                          0 -1px 0 rgba(255, 255, 255, 0.05),
                          1px 1px 0 rgba(0, 0, 0, 0.2),
                          -1px 1px 0 rgba(0, 0, 0, 0.15)
                        `
                        : `
                          0 1px 0 rgba(0, 0, 0, 0.22),
                          0 -1px 0 rgba(255, 255, 255, 0.65),
                          1px 1px 0 rgba(0, 0, 0, 0.12),
                          -1px 1px 0 rgba(0, 0, 0, 0.10)
                        `
                    }
                  }}
                >
                  {item.label}
                </motion.button>
              )
            })}
          </div>
        )}
      </div>
    </motion.nav>
  )
}
