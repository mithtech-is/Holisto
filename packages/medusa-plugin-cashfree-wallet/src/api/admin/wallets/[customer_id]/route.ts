import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"

/**
 * GET /admin/wallets/:customer_id
 *
 * Admin view of a single customer: wallet summary + ledger + derived KYC
 * status + all bank and demat rows. Everything the "Customer wallet" and
 * "Manual verify" admin UI tabs need in a single call.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { customer_id } = req.params
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const customerModule = req.scope.resolve("customer") as any
  const [summary, kyc, banks, demats, [transactions], customer] =
    await Promise.all([
      walletModule.getWalletSummary(customer_id as string),
      walletModule.getKycStatus(customer_id as string),
      walletModule.listBankAccounts({ customer_id: customer_id as string }),
      walletModule.listDematAccounts({ customer_id: customer_id as string }),
      walletModule.listAndCountWalletTransactions(
        { customer_id },
        { take: 100, order: { created_at: "DESC" } as any }
      ),
      customerModule.retrieveCustomer(customer_id as string).catch(() => null),
    ])
  res.json({
    wallet: summary,
    customer: customer
      ? {
          id: customer.id,
          email: customer.email,
          first_name: customer.first_name,
          last_name: customer.last_name,
          phone: customer.phone,
          // These are the per-customer document uploads (optional,
          // non-gating). Strictly allowlisted by customer-validator.
          pan_card_file_url:
            customer.metadata?.pan_card_file_url ?? null,
          aadhaar_card_file_url:
            customer.metadata?.aadhaar_card_file_url ?? null,
        }
      : null,
    kyc,
    banks: banks.map((b) => ({
      id: b.id,
      account_holder_name: b.account_holder_name,
      account_number_last4: b.account_number_last4,
      ifsc: b.ifsc,
      bank_name: b.bank_name,
      verification_status: b.verification_status,
      name_match_score: b.name_match_score,
      is_primary: b.is_primary,
      verified_at: b.verified_at,
      created_at: b.created_at,
      bank_proof_file_url: b.bank_proof_file_url,
      bank_proof_type: b.bank_proof_type,
    })),
    demats: demats.map((d) => ({
      id: d.id,
      depository: d.depository,
      dp_id: d.dp_id,
      client_id: d.client_id,
      boid: d.boid,
      dp_name: d.dp_name,
      account_holder_name: d.account_holder_name,
      cmr_file_url: d.cmr_file_url,
      name_match_score: d.name_match_score,
      verification_status: d.verification_status,
      is_primary: d.is_primary,
      verified_at: d.verified_at,
      created_at: d.created_at,
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      direction: t.direction,
      amount_inr: t.amount_inr,
      balance_after: t.balance_after,
      kind: t.kind,
      // Which sub-balance the row mutated. Older rows surface as
      // "main" via the column default — the admin UI badges promo
      // rows so the operator can see the split at a glance.
      bucket: (t as any).bucket ?? "main",
      reference_type: t.reference_type,
      reference_id: t.reference_id,
      note: t.note,
      metadata: t.metadata,
      created_at: t.created_at,
    })),
  })
}
