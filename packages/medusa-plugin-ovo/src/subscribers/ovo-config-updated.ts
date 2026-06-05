import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

/**
 * Example subscriber.
 *
 * Listens for an `ovo.config.updated` event so a host app can react to
 * OVO settings changes (e.g. trigger its own cache bust or re-index).
 * Inert by default — the plugin doesn't emit this event itself, so this
 * is a safe extension point rather than active behaviour. Replace the
 * body with your own side effect, or remove this file if unused.
 */
export default async function ovoConfigUpdatedHandler({
  event,
  container,
}: SubscriberArgs<{ id?: string }>) {
  const logger = container.resolve("logger")
  logger.info(
    `[ovo] config-updated event received (id=${event?.data?.id ?? "n/a"})`,
  )
}

export const config: SubscriberConfig = {
  event: "ovo.config.updated",
}
