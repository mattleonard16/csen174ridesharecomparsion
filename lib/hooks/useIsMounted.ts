'use client'

import { useSyncExternalStore } from 'react'

const emptySubscribe = () => () => {}
const getSnapshot = () => true
const getServerSnapshot = () => false

export function useIsMounted() {
  return useSyncExternalStore(emptySubscribe, getSnapshot, getServerSnapshot)
}
