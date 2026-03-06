import {
  DEFAULT_PROVIDER_CONFIG_PATH,
  DEFAULT_ROUTES_CONFIG_PATH,
  resolveQuoteConfigPaths,
} from '@/scripts/fetch-quotes-config'

describe('resolveQuoteConfigPaths', () => {
  it('returns the organized scripts/config defaults when no args are passed', () => {
    expect(resolveQuoteConfigPaths([])).toEqual({
      providersPath: DEFAULT_PROVIDER_CONFIG_PATH,
      routesPath: DEFAULT_ROUTES_CONFIG_PATH,
    })
  })

  it('preserves explicit CLI overrides', () => {
    expect(resolveQuoteConfigPaths(['custom/providers.json', 'custom/routes.json'])).toEqual({
      providersPath: 'custom/providers.json',
      routesPath: 'custom/routes.json',
    })
  })
})
