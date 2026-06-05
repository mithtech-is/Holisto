import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import {
  CUSTOMER_IDENTITY_MODULE,
  CustomerIdentityService,
} from "../../../../../modules/customer_identity"
import { logger } from "../../../../../utils/logger"

/**
 * POST /admin/customers/:customer_id/provision-vba
 *
 * Operator-triggered VBA provisioning for a specific customer.
 * Mirrors the storefront-side `/store/bank-accounts/:id/provision-vba`
 * retry route, but resolves the customer by id (not by bank ownership)
 * and is intended for ops use cases:
 *   - Backfilling a VBA for a customer whose first verified bank
 *     happened before today's auto-trigger code shipped.
 *   - Re-trying after a Cashfree blip or merchant-side config fix.
 *   - Minting a fresh VBA after a `client_id` reset (the old VBA on
 *     Cashfree's side stays, but our DB row was marked closed and a
 *     new VBA gets minted under the new `client_id`).
 *
 * Hard requirements (returns 4xx if violated):
 *   - The customer exists.
 *   - At least one bank_account row for the customer is in
 *     `verification_status = 'verified'`. Without that, Cashfree's
 *     remitter_lock_details lock would be empty and we'd be opening
 *     up a wallet to any sender.
 *
 * Idempotent: if the customer already has an `active` VBA in our
 * `cashfree_virtual_account` table, we return that row unchanged
 * (no Cashfree call). Re-running this against an active state is a
 * no-op.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { customer_id } = req.params as { customer_id: string }
  if (!customer_id) {
    return res.status(400).json({ message: "Missing customer_id" })
  }

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService
  const customerModule: any = req.scope.resolve(Modules.CUSTOMER)
  const identity = req.scope.resolve(
    CUSTOMER_IDENTITY_MODULE,
  ) as CustomerIdentityService

  const customer = await customerModule
    .retrieveCustomer(customer_id)
    .catch(() => null)
  if (!customer) {
    return res.status(404).json({ message: "Customer not found" })
  }

  const verifiedBanks = await walletModule.listBankAccounts({
    customer_id,
    verification_status: "verified",
  })
  if (!verifiedBanks.length) {
    return res.status(400).json({
      ok: false,
      code: "vba.no_verified_bank",
      message:
        "Customer has no verified bank account — VBA creation requires at least one to populate allowed_remitters.",
    })
  }

  // Resolve / lazily-assign the customer's stable client_id. Used as
  // Cashfree's `virtual_account_id`.
  let clientIdRow = await identity.getByCustomerId(customer_id)
  if (!clientIdRow?.client_id) {
    clientIdRow = await identity.assignClientId(
      customer_id,
      customer.created_at ?? new Date(),
    )
  }

  const fullName =
    [customer.first_name, customer.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    verifiedBanks[0]?.account_holder_name ||
    "Polemarch Investor"

  try {
    const vba = await walletModule.provisionVirtualAccountForCustomer({
      customer_id,
      client_id: clientIdRow.client_id,
      customer_name: fullName,
      customer_email: customer.email || `${customer_id}@noreply.polemarch.in`,
      customer_phone: customer.phone || "0000000000",
      customer_metadata: (customer.metadata ?? null) as
        | Record<string, unknown>
        | null,
    })
    if (!vba) {
      return res
        .status(500)
        .json({ message: "Cashfree returned no VBA" })
    }
    // After provision, push the latest verified-bank list to Cashfree
    // via PUT /pg/vba/{id}. On a fresh create this replays what we
    // just sent (idempotent); on a re-trigger against an existing VBA
    // this is what gets newly-added banks into Cashfree's lock list.
    // Best-effort.
    try {
      await walletModule.syncVbaAllowedRemitters({
        customer_id,
        customer_metadata: (customer.metadata ?? null) as
          | Record<string, unknown>
          | null,
      })
    } catch (syncErr) {
      logger.warn(
        "admin provision-vba: allowed-remitters sync failed (non-blocking)",
        {
          customer_id,
          error: (syncErr as Error).message,
        },
      )
    }
    return res.json({
      ok: true,
      customer_id,
      client_id: clientIdRow.client_id,
      virtual_account: {
        id: (vba as any).id,
        virtual_account_id: (vba as any).virtual_account_id,
        virtual_account_number: vba.virtual_account_number,
        ifsc: vba.ifsc,
        upi_id: vba.upi_id,
        beneficiary_name: vba.beneficiary_name,
        bank_code: vba.bank_code,
        status: (vba as any).status,
      },
    })
  } catch (err) {
    logger.error("admin VBA provision failed", {
      customer_id,
      error: err,
    })
    const raw = (err as Error).message ?? ""
    const merchantConfigIssue =
      raw.includes("default_virtual_account_not_found") ||
      raw.includes("default bank not present")
    if (merchantConfigIssue) {
      return res.status(503).json({
        ok: false,
        code: "vba.merchant_default_bank_missing",
        message:
          "Cashfree returned `default_virtual_account_not_found`. Your merchant account hasn't completed VBA onboarding (default issuing bank not assigned), or `bank_codes` was rejected. See cashfree dashboard → Auto Collect / VBA settings.",
      })
    }
    return res.status(502).json({
      ok: false,
      message: raw || "VBA provision failed",
    })
  }
}
