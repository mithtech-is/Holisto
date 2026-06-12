/**
 * Lightweight logger shim.
 *
 * The host app provided a `utils/logger` singleton; the copied routes,
 * subscribers, and the gamification `grant-points` helper import it as
 * `import { logger } from "<...>/utils/logger"`. This dependency-free
 * console-backed implementation preserves that surface so the plugin
 * builds standalone.
 *
 * TODO (hardening): route through Medusa's container logger
 * (`ContainerRegistrationKeys.LOGGER`) where a request scope is available,
 * so log levels honor the host app's configuration.
 */
type Meta = Record<string, unknown>

const fmt = (meta?: Meta): string => {
  if (!meta) return ""
  try {
    return " " + JSON.stringify(meta)
  } catch {
    return " [unserializable-meta]"
  }
}

const tag = "[cashfree-wallet]"

export const logger = {
  info: (msg: string, meta?: Meta) => console.info(`${tag} ${msg}${fmt(meta)}`),
  warn: (msg: string, meta?: Meta) => console.warn(`${tag} ${msg}${fmt(meta)}`),
  error: (msg: string, meta?: Meta) => console.error(`${tag} ${msg}${fmt(meta)}`),
  debug: (msg: string, meta?: Meta) => console.debug(`${tag} ${msg}${fmt(meta)}`),
}

export default logger
