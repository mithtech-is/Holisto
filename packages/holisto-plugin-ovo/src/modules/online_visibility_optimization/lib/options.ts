/**
 * Plugin option / environment helpers for the OVO module.
 *
 * Demo mode is the single switch that decides whether the module seeds
 * example data. Production default is OFF — a clean install ships no
 * brand identity, no prompts, and no metrics, so every surface shows an
 * honest setup-required / empty state until the operator configures it.
 *
 * Demo mode is enabled when EITHER the `OVO_DEMO_MODE` env var is "true"
 * OR the plugin/module is registered with `{ demo_mode: true }` (the
 * module captures its options and calls `setModuleOptions`).
 */

let capturedOptions: Record<string, unknown> = {}

/** Called once by the module service constructor with its resolved options. */
export function setModuleOptions(options: Record<string, unknown> | undefined) {
  capturedOptions = options ?? {}
}

export function getModuleOptions(): Record<string, unknown> {
  return capturedOptions
}

export function isDemoMode(): boolean {
  if (process.env.OVO_DEMO_MODE === "true") return true
  if (process.env.OVO_DEMO_MODE === "false") return false
  return capturedOptions.demo_mode === true
}

/** Read a numeric option with an env override and a safe default. */
export function getNumberOption(
  key: string,
  envName: string,
  fallback: number,
): number {
  const env = process.env[envName]
  if (env !== undefined && env !== "") {
    const n = Number(env)
    if (Number.isFinite(n)) return n
  }
  const opt = capturedOptions[key]
  if (typeof opt === "number" && Number.isFinite(opt)) return opt
  return fallback
}

/** Read a boolean option (defaults to `true` unless explicitly disabled). */
export function getBoolOption(key: string, fallback = true): boolean {
  const opt = capturedOptions[key]
  if (typeof opt === "boolean") return opt
  return fallback
}
