/**
 * Shared scaffolding for the OVO scheduled jobs.
 *
 * Every job:
 *   - respects the `enable_jobs` plugin option and the `OVO_ENABLE_JOBS`
 *     env kill-switch (set to "false" to disable all OVO crons);
 *   - resolves the OVO module service from the container (and skips
 *     gracefully if the module isn't registered);
 *   - lets the service self-gate on missing credentials (each ingest /
 *     audit method soft-skips and returns zero work when unconfigured);
 *   - NEVER throws — a failing provider logs and the job returns, so one
 *     bad integration can't crash the Medusa instance or block other
 *     crons.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ONLINE_VISIBILITY_OPTIMIZATION_MODULE } from "../modules/online_visibility_optimization"
import { getBoolOption } from "../modules/online_visibility_optimization/lib/options"

type AnyService = Record<string, (...args: any[]) => any>

export async function runOvoJob(
  container: MedusaContainer,
  name: string,
  run: (ovo: AnyService, logger: any) => Promise<unknown>,
): Promise<void> {
  let logger: any
  try {
    logger = container.resolve("logger")
  } catch {
    // eslint-disable-next-line no-console
    logger = console
  }

  if (process.env.OVO_ENABLE_JOBS === "false") {
    logger.info?.(`[ovo] job "${name}" skipped (OVO_ENABLE_JOBS=false)`)
    return
  }

  let ovo: AnyService
  try {
    ovo = container.resolve(ONLINE_VISIBILITY_OPTIMIZATION_MODULE) as AnyService
  } catch {
    logger.warn?.(
      `[ovo] job "${name}" skipped — module "${ONLINE_VISIBILITY_OPTIMIZATION_MODULE}" ` +
        `is not registered. Add it to the "modules" array in medusa-config.ts.`,
    )
    return
  }

  // `enable_jobs` defaults to true; only an explicit option/env disables.
  if (!getBoolOption("enable_jobs", true)) {
    logger.info?.(`[ovo] job "${name}" skipped (enable_jobs=false)`)
    return
  }

  const t0 = Date.now()
  try {
    const result = await run(ovo, logger)
    logger.info?.(`[ovo] job "${name}" completed in ${Date.now() - t0}ms`, result)
  } catch (err) {
    // Swallow — never let a job failure bubble into the scheduler.
    logger.error?.(`[ovo] job "${name}" failed after ${Date.now() - t0}ms`, {
      error: err instanceof Error ? err.message : err,
    })
  }
}
