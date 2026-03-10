'use client'
import { createPortal } from 'react-dom'
import { useIsMounted } from '@/lib/hooks/useIsMounted'

export default function ModalPortal({ children }: { children: React.ReactNode }) {
  const mounted = useIsMounted()

  if (!mounted) return null

  return createPortal(children, document.body)
}
