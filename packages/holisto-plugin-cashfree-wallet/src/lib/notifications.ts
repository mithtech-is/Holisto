/**
 * Pluggable notification adapter.
 *
 * The host app sent customer emails through a `polemarch_communication`
 * module. A redistributable plugin must NOT drag that module in, so all
 * customer-facing notifications are decoupled: the plugin simply EMITS an
 * event on Medusa's Event Bus, and the installing app subscribes to those
 * events and wires its own email / SMS / push provider.
 *
 * Event names emitted (data payload in parentheses):
 *   - wallet.credited   ({ customer_id, amount_inr, reason, note, wallet_balance_inr, bucket })
 *   - wallet.debited    (same shape)
 *   - wallet.frozen     ({ customer_id, note })
 *
 * Installers: add a subscriber on these names to send notifications.
 * If no subscriber exists, the emit is a harmless no-op.
 */
import { Modules } from "@medusajs/framework/utils"

export async function emitWalletNotification(
  scope: any,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const eventBus = scope?.resolve?.(Modules.EVENT_BUS, {
      allowUnregistered: true,
    })
    if (eventBus?.emit) {
      await eventBus.emit({ name: event, data: payload ?? {} })
    }
  } catch {
    // Notifications are strictly best-effort; never block a wallet
    // mutation because the event bus is unavailable.
  }
}
