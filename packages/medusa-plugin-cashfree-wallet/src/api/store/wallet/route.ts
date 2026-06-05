import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"
import { logger } from "../../../utils/logger"

/**
 * GET /store/wallet
 *
 * Returns the customer's wallet balance + every Cashfree Virtual Account
 * they have. Each VBA is locked (via Cashfree `allowed_remitters`) to
 * exactly one of the customer's verified bank accounts — the storefront
 * renders one deposit card per VBA, alongside the source bank.
 *
 * VBAs are NOT created here — they're provisioned automatically when a
 * customer adds + verifies a bank account in `/store/bank-accounts`.
 * If the array is empty, the storefront should nudge the user to add a
 * bank.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  try {
    const [summary, settingRows] = await Promise.all([
      walletModule.getWalletSummary(customerId),
      walletModule
        .listCashfreeSettings({ singleton_key: "default" } as any, { take: 1 })
        .catch(() => [] as any[]),
    ])

    // Apply the platform-level beneficiary override so the wallet
    // page renders the admin-editable name (e.g. "Mithtech
    // Innovative Solutions PVT LTD") instead of the per-VBA stored
    // value (which is the customer's PAN name on Cashfree's side).
    // Same pattern used in GET /store/bank-accounts. Cashfree's PG
    // VBA API can't update the dashboard-side Account Holder Name
    // post-create, so we mask only at display time.
    const platformBeneficiary =
      typeof (settingRows[0] as any)?.beneficiary_name === "string" &&
      (settingRows[0] as any).beneficiary_name.trim().length > 0
        ? (settingRows[0] as any).beneficiary_name.trim()
        : null

    const overridden = {
      ...summary,
      virtual_accounts: (summary as any).virtual_accounts.map((v: any) => ({
        ...v,
        beneficiary_name: platformBeneficiary ?? v.beneficiary_name,
      })),
    }
    res.json(overridden)
  } catch (err) {
    logger.error("wallet summary failed", { customerId, error: err })
    res.status(500).json({ message: "Failed to load wallet" })
  }
}
