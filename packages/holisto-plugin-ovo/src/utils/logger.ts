/**
 * Lightweight logger for the OVO admin API routes.
 *
 * The original host-app routes imported a shared `utils/logger`. In a
 * reusable plugin we can't depend on the host app's logger module, so
 * this provides an equivalent console-backed shim with the same
 * `(message, meta?)` call shape. Output is prefixed with `[ovo]` so it
 * is easy to grep in a host app's combined logs.
 *
 * Route handlers also have access to Medusa's container-bound logger via
 * `req.scope.resolve("logger")` when richer logging is wanted; this shim
 * keeps the copied route code working without rewrites.
 */
type Meta = Record<string, unknown> | unknown

function fmt(meta?: Meta): unknown[] {
  return meta === undefined ? [] : [meta]
}

export const logger = {
  debug(message: string, meta?: Meta): void {
    // eslint-disable-next-line no-console
    console.debug(`[ovo] ${message}`, ...fmt(meta))
  },
  info(message: string, meta?: Meta): void {
    // eslint-disable-next-line no-console
    console.info(`[ovo] ${message}`, ...fmt(meta))
  },
  warn(message: string, meta?: Meta): void {
    // eslint-disable-next-line no-console
    console.warn(`[ovo] ${message}`, ...fmt(meta))
  },
  error(message: string, meta?: Meta): void {
    // eslint-disable-next-line no-console
    console.error(`[ovo] ${message}`, ...fmt(meta))
  },
}

export default logger
