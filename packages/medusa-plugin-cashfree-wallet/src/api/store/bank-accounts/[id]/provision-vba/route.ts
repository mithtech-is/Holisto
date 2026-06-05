import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import { logger } from "../../../../../utils/logger"

/**
 * POST /store/bank-accounts/:id/provision-vba
 *
 * Idempotent retry for VBA provisioning. Used when the inline call from
 * `POST /store/bank-accounts` fails (Cashfree blip, missing creds at the
 * time, etc.) and the bank record exists without a virtual account.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })
  const { id } = req.params

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const bank = await walletModule
    .retrieveBankAccount(id as string)
    .catch(() => null)
  if (!bank || bank.customer_id !== customerId) {
    return res.status(404).json({ message: "Not found" })
  }
  if (bank.verification_status !== "verified") {
    return res
      .status(400)
      .json({ message: "Bank must be verified before a VBA can be created" })
  }

  try {
    const customerModule = req.scope.resolve("customer") as any
    const customer = await customerModule.retrieveCustomer(customerId)
    const fullName =
      [customer?.first_name, customer?.last_name]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      bank.account_holder_name ||
      "Polemarch Investor"
    // Resolve the customer's stable client_id. The bank-add path
    // (POST /store/bank-accounts) gates on PAN verification, which
    // mints this row; by the time a bank exists and is verified
    // (required above), the client_id must already exist. If
    // somehow not, the identity state is inconsistent — surface a
    // 412 so the user re-verifies PAN to heal (registry-reattach
    // recreates the customer_client_id row).
    const ci = req.scope.resolve("customer_identity") as any
    const clientIdRow = await ci.getByCustomerId(customerId)
    if (!clientIdRow?.client_id) {
      return res.status(412).json({
        ok: false,
        code: "kyc.pan_required",
        message:
          "PAN verification is required before provisioning a virtual account. Complete PAN KYC and try again.",
      })
    }
    const vba = await walletModule.provisionVirtualAccountForCustomer({
      customer_id: customerId,
      client_id: clientIdRow.client_id,
      customer_name: fullName,
      customer_email: customer?.email || `${customerId}@noreply.polemarch.in`,
      customer_phone: customer?.phone || "0000000000",
      customer_metadata: (customer?.metadata ?? null) as
        | Record<string, unknown>
        | null,
    })
    if (!vba) {
      return res
        .status(500)
        .json({ message: "Cashfree returned no VBA" })
    }
    // After (re)provisioning, push the latest verified-bank list onto
    // Cashfree's allowed_remitters via PUT /pg/vba/{id}. Provision
    // already covers this on first creation, but retry calls usually
    // mean banks were added since the original failure — sync makes
    // the lock list authoritative either way. Best-effort.
    try {
      await walletModule.syncVbaAllowedRemitters({
        customer_id: customerId,
        customer_metadata: (customer?.metadata ?? null) as
          | Record<string, unknown>
          | null,
      })
    } catch (syncErr) {
      logger.warn(
        "VBA retry: allowed-remitters sync failed (non-blocking)",
        {
          customer_id: customerId,
          bank_account_id: bank.id,
          error: (syncErr as Error).message,
        },
      )
    }
    res.json({
      virtual_account: {
        virtual_account_number: vba.virtual_account_number,
        ifsc: vba.ifsc,
        upi_id: vba.upi_id,
        beneficiary_name: vba.beneficiary_name,
        bank_code: vba.bank_code,
      },
    })
  } catch (err) {
    logger.error("VBA provision retry failed", {
      bank_account_id: bank.id,
      error: err,
    })
    // Translate Cashfree's most common merchant-side configuration
    // failure into a message ops can act on. The raw text from
    // Cashfree ("default bank not present for VBA") looks like a
    // bug from the storefront's perspective; it isn't — it means
    // the Cashfree merchant dashboard hasn't had a default Auto
    // Collect bank set yet.
    const raw = (err as Error).message ?? ""
    const merchantConfigIssue =
      raw.includes("default_virtual_account_not_found") ||
      raw.includes("default bank not present")
    if (merchantConfigIssue) {
      return res.status(503).json({
        ok: false,
        code: "vba.merchant_default_bank_missing",
        message:
          "Virtual account provisioning is temporarily unavailable. " +
          "Our payments partner is finalising onboarding — try again in a few minutes, " +
          "or contact support if this persists.",
      })
    }
    res.status(502).json({ message: raw || "VBA provision failed" })
  }
}
