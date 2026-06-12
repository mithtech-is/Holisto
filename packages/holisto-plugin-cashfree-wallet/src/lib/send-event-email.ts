/**
 * Customer notification entry point.
 *
 * Decoupled from any email module: emits the event on Medusa's Event Bus
 * (see ./notifications). Installers subscribe to `wallet.*` / `kyc.*`
 * events to send their own email/SMS/push. No-op if nothing subscribes.
 *
 * Kept as `sendEventEmail(scope, event, payload)` so the many call sites
 * read naturally; the signature is intentionally stable.
 */
import { emitWalletNotification } from "./notifications"

export async function sendEventEmail(
  scope: any,
  event: string,
  payload: Record<string, unknown>,
  _opts?: Record<string, unknown>
): Promise<void> {
  await emitWalletNotification(scope, event, payload)
}

export default sendEventEmail
