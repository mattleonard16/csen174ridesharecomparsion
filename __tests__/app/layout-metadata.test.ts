jest.mock('next/font/google', () => ({
  Playfair_Display: () => ({ variable: '--font-playfair' }),
  DM_Sans: () => ({ variable: '--font-dm-sans' }),
  Space_Mono: () => ({ variable: '--font-space-mono' }),
}))

jest.mock('next/dynamic', () => () => function DynamicStub() {
  return null
})

jest.mock('@vercel/analytics/react', () => ({
  Analytics: () => null,
}))

import { metadata } from '@/app/layout'

describe('layout metadata', () => {
  it('uses current mobile web app metadata without the deprecated Apple capable flag', () => {
    expect(metadata.other).toMatchObject({
      'mobile-web-app-capable': 'yes',
    })
    expect(metadata.appleWebApp).toMatchObject({
      statusBarStyle: 'default',
      title: 'RideCompare',
    })
    expect(metadata.appleWebApp).not.toHaveProperty('capable')
  })
})
