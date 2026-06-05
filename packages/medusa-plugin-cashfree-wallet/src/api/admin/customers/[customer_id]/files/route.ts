import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"

type FileEntry = {
  /** Stable file URL — the public path that renders the asset. */
  url: string
  /** What this file is (PAN copy, Aadhaar copy, CMR, etc.). */
  kind: string
  /** Which entity owns the reference. Lets ops know where to edit. */
  source: {
    entity: "customer_metadata" | "bank_account" | "demat_account" | "deposit_proof"
    id: string
  }
  /** Best-effort human label (e.g. bank name, demat DP name). */
  label?: string
  /** Timestamp of the source record, if available. */
  created_at?: string | null
}

/**
 * GET /admin/customers/:customer_id/files
 *
 * Unions every file URL attached to this customer across KYC metadata,
 * bank account proofs, demat CMRs, and deposit proofs. Used by the
 * "Documents" tab on the Customer 360 admin page.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { customer_id } = req.params
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const customerModule = req.scope.resolve(Modules.CUSTOMER) as any

  const [customer, banks, demats, deposits] = await Promise.all([
    customerModule.retrieveCustomer(customer_id as string).catch(() => null),
    walletModule.listBankAccounts({ customer_id: customer_id as string }, { take: 50 }).catch(() => []),
    walletModule.listDematAccounts({ customer_id: customer_id as string }, { take: 50 }).catch(() => []),
    walletModule
      .listDepositProofs({ customer_id: customer_id as string }, { take: 50 })
      .catch(() => []),
  ])

  const files: FileEntry[] = []

  // KYC metadata files
  const meta = (customer?.metadata as Record<string, unknown>) ?? {}
  const metaFiles: Array<{ key: string; kind: string }> = [
    { key: "kyc_pan_file_url", kind: "PAN card" },
    { key: "kyc_aadhaar_card_file_url", kind: "Aadhaar card" },
    // Legacy single-CMR slot. Pre-multi-demat data lives here; new
    // CMRs go on `demat_account.cmr_file_url` per demat. Surfaced in
    // the listing so old uploads stay visible, but the upload picker
    // no longer offers this as a destination.
    { key: "kyc_cmr_file_url", kind: "CMR copy (pre-multi-demat)" },
    { key: "pan_card_file_url", kind: "PAN card (legacy)" },
    { key: "aadhaar_card_file_url", kind: "Aadhaar card (legacy)" },
  ]
  for (const { key, kind } of metaFiles) {
    const url = meta[key]
    if (typeof url === "string" && url.trim()) {
      files.push({
        url,
        kind,
        source: { entity: "customer_metadata", id: customer_id as string },
      })
    }
  }

  // Bank account proofs
  for (const b of banks as any[]) {
    if (b.bank_proof_file_url) {
      files.push({
        url: b.bank_proof_file_url,
        kind: `Bank proof (${b.bank_proof_type ?? "unknown"})`,
        source: { entity: "bank_account", id: b.id },
        label: `${b.bank_name ?? "Bank"} · …${b.account_number_last4 ?? "????"}`,
        created_at: b.created_at,
      })
    }
  }

  // Demat CMRs
  for (const d of demats as any[]) {
    if (d.cmr_file_url) {
      files.push({
        url: d.cmr_file_url,
        kind: "Demat CMR",
        source: { entity: "demat_account", id: d.id },
        label: `${d.depository ?? "Demat"} · ${d.dp_name ?? "?"}`,
        created_at: d.created_at,
      })
    }
  }

  // Deposit proofs
  for (const p of deposits as any[]) {
    if (p.proof_file_url) {
      files.push({
        url: p.proof_file_url,
        kind: `Deposit proof (${p.status})`,
        source: { entity: "deposit_proof", id: p.id },
        label: `₹${p.claimed_amount_inr?.toLocaleString?.("en-IN") ?? p.claimed_amount_inr}${p.utr ? ` · UTR ${p.utr}` : ""}`,
        created_at: p.created_at,
      })
    }
  }

  return res.json({ files })
}
