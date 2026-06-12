/**
 * Cashfree Payouts Virtual Accounts wrapper.
 *
 * One persistent VBA per customer. Bank transfers (IMPS/NEFT/RTGS/UPI) into
 * the VBA arrive on the VBA-credit webhook (`/webhooks/cashfree/vba`) and we
 * credit the customer's wallet there.
 */

import { CashfreeClient, getPayoutsClient } from "./client"

export type CreateVbaArgs = {
  /** Stable, unique merchant-side id — we use customer.id */
  vAccountId: string
  /** Display name on the receiving account */
  name: string
  phone: string
  email: string
}

export type CreateVbaResult = {
  virtual_account_id: string
  virtual_account_number: string
  ifsc: string
  upi_id?: string | null
  beneficiary_name?: string | null
  raw: Record<string, unknown>
}

export async function createVirtualAccount(
  client: CashfreeClient,
  args: CreateVbaArgs
): Promise<CreateVbaResult> {
  const res = await client.request<Record<string, unknown>>({
    method: "POST",
    path: "/payout/v1.2/createVirtualAccount",
    body: {
      vAccountId: args.vAccountId,
      name: args.name,
      phone: args.phone,
      email: args.email,
    },
    idempotencyKey: `vba_create_${args.vAccountId}`,
  })
  const data =
    ((res.data as Record<string, unknown>)?.data as Record<string, unknown>) ??
    (res.data as Record<string, unknown>) ??
    {}
  return {
    virtual_account_id: String(
      (data as any).vAccountId ?? args.vAccountId
    ),
    virtual_account_number: String((data as any).virtualAccountNumber ?? ""),
    ifsc: String((data as any).ifsc ?? ""),
    upi_id: ((data as any).vpa as string | undefined) ?? null,
    beneficiary_name: ((data as any).beneficiaryName as string | undefined) ?? args.name,
    raw: data,
  }
}

export async function fetchVirtualAccount(
  client: CashfreeClient,
  vAccountId: string
): Promise<CreateVbaResult | null> {
  try {
    const res = await client.request<Record<string, unknown>>({
      method: "GET",
      path: `/payout/v1.2/getVirtualAccount/${encodeURIComponent(vAccountId)}`,
    })
    const data =
      ((res.data as Record<string, unknown>)?.data as Record<string, unknown>) ??
      (res.data as Record<string, unknown>) ??
      {}
    if (!(data as any).virtualAccountNumber) return null
    return {
      virtual_account_id: String((data as any).vAccountId ?? vAccountId),
      virtual_account_number: String((data as any).virtualAccountNumber),
      ifsc: String((data as any).ifsc ?? ""),
      upi_id: ((data as any).vpa as string | undefined) ?? null,
      beneficiary_name: (data as any).beneficiaryName as string | undefined,
      raw: data,
    }
  } catch {
    return null
  }
}

export type VirtualAccountTransaction = {
  transfer_id: string
  amount: number
  utr?: string
  remitter_account_number?: string
  remitter_ifsc?: string
  remitter_name?: string
  status: string
  added_on?: string
  raw: Record<string, unknown>
}

export async function listVirtualAccountTransactions(
  client: CashfreeClient,
  vAccountId: string
): Promise<VirtualAccountTransaction[]> {
  const res = await client.request<Record<string, unknown>>({
    method: "GET",
    path: `/payout/v1.2/getVirtualAccountTransactions/${encodeURIComponent(vAccountId)}`,
  })
  const data =
    ((res.data as Record<string, unknown>)?.data as Record<string, unknown>) ??
    (res.data as Record<string, unknown>) ??
    {}
  const items =
    ((data as any).transactions as Record<string, unknown>[]) ??
    ((data as any).items as Record<string, unknown>[]) ??
    []
  return items.map((t) => ({
    transfer_id: String((t as any).transferId ?? (t as any).transfer_id ?? ""),
    amount: Number((t as any).amount ?? 0),
    utr: (t as any).utr as string | undefined,
    remitter_account_number: (t as any).remitterAccount as string | undefined,
    remitter_ifsc: (t as any).remitterIfsc as string | undefined,
    remitter_name: (t as any).remitterName as string | undefined,
    status: String((t as any).status ?? ""),
    added_on: (t as any).addedOn as string | undefined,
    raw: t,
  }))
}

/**
 * @deprecated Use `await walletModule.getVbaApi()` instead — that path
 * reads the live DB-backed credentials. This factory only sees env vars.
 */
export function getVbaApi() {
  const client = getPayoutsClient()
  return {
    create: (a: CreateVbaArgs) => createVirtualAccount(client, a),
    fetch: (id: string) => fetchVirtualAccount(client, id),
    listTransactions: (id: string) => listVirtualAccountTransactions(client, id),
  }
}
