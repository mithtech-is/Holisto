import { useEffect, useState } from "react"
import { Container, Heading, Text, StatusBadge, Button } from "@medusajs/ui"
import { adminFetch, formatInr, formatDate, statusBadgeColor } from "../helpers"

type Props = { customerId: string }

export default function OverviewTab({ customerId }: Props) {
  const [data, setData] = useState<{
    customer: any
    wallet: any
    kyc: any
    banks_count: number
    demat_count: number
    client_id: string | null
    referral_code: string | null
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    ;(async () => {
      try {
        const [c, w, k, banks, demats, ci, ref] = await Promise.all([
          adminFetch<{ customer: any }>(`/admin/customers/${customerId}`),
          adminFetch<{ wallet: any }>(`/admin/wallets/${customerId}`).catch(() => ({
            wallet: null,
          })),
          adminFetch<{ kyc: any }>(`/admin/customers/${customerId}/kyc`).catch(
            () => ({ kyc: null })
          ),
          adminFetch<{ bank_accounts: any[] }>(
            `/admin/bank-accounts?customer_id=${customerId}`
          ).catch(() => ({ bank_accounts: [] })),
          adminFetch<{ demat_accounts: any[] }>(
            `/admin/demat-accounts?customer_id=${customerId}`
          ).catch(() => ({ demat_accounts: [] })),
          adminFetch<{ client_id: string | null }>(
            `/admin/customer-client-id?customer_id=${customerId}`
          ).catch(() => ({ client_id: null })),
          // Resolves the customer's own shareable referral code via
          // `referralStats` (auto-creates the template row on first call,
          // so even a brand-new customer gets a code surfaced here).
          adminFetch<{ code: string | null }>(
            `/admin/customers/${customerId}/referral`
          ).catch(() => ({ code: null })),
        ])
        if (!alive) return
        setData({
          customer: c.customer,
          wallet: (w as any).wallet ?? w,
          kyc: (k as any).kyc,
          banks_count: (banks.bank_accounts ?? []).length,
          demat_count: (demats.demat_accounts ?? []).length,
          client_id: ci.client_id,
          referral_code: ref.code ?? null,
        })
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load")
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [customerId])

  if (loading) return <Text>Loading…</Text>
  if (error) return <Text className="text-ui-fg-error">{error}</Text>
  if (!data) return null

  const c = data.customer
  const w = data.wallet
  const k = data.kyc

  return (
    <div className="flex flex-col gap-4">
      {/* Identity summary */}
      <Container className="p-6">
        <Heading level="h3" className="mb-3">
          Identity
        </Heading>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-6 text-sm">
          <Field
            label="Client ID"
            value={
              data.client_id ? (
                <code className="font-bold tracking-wider">{data.client_id}</code>
              ) : (
                <span className="text-ui-fg-muted">—</span>
              )
            }
          />
          <Field label="Customer ID" value={<code>{c?.id}</code>} />
          <Field label="Email" value={c?.email} />
          <Field label="First name" value={c?.first_name || "—"} />
          <Field label="Last name" value={c?.last_name || "—"} />
          <Field label="Phone" value={c?.phone || "—"} />
          <Field
            label="Created"
            value={formatDate(c?.created_at)}
          />
          <Field
            label="Referral code"
            value={
              data.referral_code ? (
                <code className="font-bold tracking-wider">
                  {data.referral_code}
                </code>
              ) : (
                <span className="text-ui-fg-muted">—</span>
              )
            }
          />
        </div>
      </Container>

      {/* KYC + Wallet + Accounts — 3-up */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Container className="p-6">
          <Text className="text-ui-fg-muted text-xs uppercase tracking-widest mb-2">
            KYC Status
          </Text>
          <div className="mb-2">
            <StatusBadge color={statusBadgeColor(k?.overall ?? "pending")}>
              {k?.overall ?? "not started"}
            </StatusBadge>
          </div>
          <Text size="small" className="text-ui-fg-muted">
            Last updated: {formatDate(k?.last_updated_at ?? null)}
          </Text>
        </Container>

        <Container className="p-6">
          <Text className="text-ui-fg-muted text-xs uppercase tracking-widest mb-2">
            Wallet
          </Text>
          <Heading level="h2" className="mb-1">
            {formatInr(w?.balance_inr ?? 0)}
          </Heading>
          <div>
            <StatusBadge color={statusBadgeColor(w?.status ?? "active")}>
              {w?.status ?? "—"}
            </StatusBadge>
          </div>
        </Container>

        <Container className="p-6">
          <Text className="text-ui-fg-muted text-xs uppercase tracking-widest mb-2">
            Linked accounts
          </Text>
          <Heading level="h2" className="mb-1">
            {data.banks_count + data.demat_count}
          </Heading>
          <Text size="small" className="text-ui-fg-muted">
            {data.banks_count} bank · {data.demat_count} demat
          </Text>
        </Container>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex gap-2">
      <Text className="text-ui-fg-muted w-32 shrink-0">{label}</Text>
      <Text className="font-medium">{value}</Text>
    </div>
  )
}
