export const DEFAULT_PROVIDER_CONFIG_PATH = 'scripts/config/quotes.providers.json'
export const DEFAULT_ROUTES_CONFIG_PATH = 'scripts/config/quotes.routes.json'

export function resolveQuoteConfigPaths(args: string[] = process.argv.slice(2)) {
  const [providersPath = DEFAULT_PROVIDER_CONFIG_PATH, routesPath = DEFAULT_ROUTES_CONFIG_PATH] =
    args

  return { providersPath, routesPath }
}
