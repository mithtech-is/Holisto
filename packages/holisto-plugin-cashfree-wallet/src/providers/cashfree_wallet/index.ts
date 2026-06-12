import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { CashfreeWalletPaymentProviderService } from "./service"

/**
 * Medusa payment module provider for Polemarch's internal INR wallet.
 *
 * Registered as provider id `cashfree-wallet` under the core Payment module.
 * Debits the customer's wallet at authorize time; on insufficient funds it
 * creates a HeldOrder and returns `pending`, so the customer can add funds
 * their Cashfree Virtual Account and the order auto-captures later.
 *
 * Full implementation lives in `./service.ts` (see build auth phase).
 */
export default ModuleProvider(Modules.PAYMENT, {
  services: [CashfreeWalletPaymentProviderService],
})
