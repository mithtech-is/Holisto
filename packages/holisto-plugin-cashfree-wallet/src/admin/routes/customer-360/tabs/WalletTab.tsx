import { useEffect, useState } from "react"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  StatusBadge,
  Table,
  Text,
  Textarea,
} from "@medusajs/ui"
import { adminFetch, formatInr, formatDate, statusBadgeColor } from "../helpers"

type Props = { customerId: string }

type WalletTx = {
  id: string
  direction: "credit" | "debit"
  amount_inr: number
  balance_after: number
  kind: string
  /** Which sub-balance the row mutated. Older rows surface as
   *  "main" via the column default. */
  bucket?: "main" | "promo"
  reference_type: string | null
  reference_id: string | null
  note: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

const REASON_CODES: Array<{ value: string; label: string }> = [
  { value: "promo", label: "Promotional credit" },
  { value: "goodwill", label: "Goodwill / compensation" },
  { value: "reconciliation", label: "Reconciliation" },
  { value: "correction", label: "Correction (admin error)" },
  { value: "other", label: "Other" },
]

export default function WalletTab({ customerId }: Props) {
  const [wallet, setWallet] = useState<any>(null)
  const [txs, setTxs] = useState<WalletTx[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Adjust form
  const [direction, setDirection] = useState<"credit" | "debit">("credit")
  const [bucket, setBucket] = useState<"main" | "promo">("main")
  const [amount, setAmount] = useState<string>("")
  const [reasonCode, setReasonCode] = useState<string>("promo")
  const [note, setNote] = useState<string>("")
  const [adjusting, setAdjusting] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminFetch<{ wallet: any; transactions: WalletTx[] }>(
        `/admin/wallets/${customerId}`
      )
      setWallet((res as any).wallet ?? res)
      setTxs(res.transactions ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  const submitAdjust = async () => {
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      alert("Enter a positive amount")
      return
    }
    if (note.trim().length < 20) {
      alert("Note must be at least 20 characters")
      return
    }
    setAdjusting(true)
    try {
      // Service expects amount_inr in PAISE. The form takes whole
      // rupees (more friendly for the operator), so we convert on
      // the way out.
      const paise = Math.round(amt * 100)
      const res = await adminFetch<{ ok?: boolean; debit?: { reason?: string } }>(
        `/admin/wallets/${customerId}/adjust`,
        {
          method: "POST",
          body: JSON.stringify({
            direction,
            amount_inr: paise,
            reason_code: reasonCode,
            note: note.trim(),
            bucket,
          }),
        },
      )
      // adminFetch throws on !res.ok, so reaching here means success.
      // (A debit returning ok:false is mapped to a 400 by the route.)
      setAmount("")
      setNote("")
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Adjust failed")
    } finally {
      setAdjusting(false)
    }
  }

  const toggleFreeze = async () => {
    const nextAction = wallet?.status === "frozen" ? "unfreeze" : "freeze"
    const reason = prompt(`Reason to ${nextAction}?`)
    if (!reason) return
    try {
      await adminFetch(`/admin/wallets/${customerId}/freeze`, {
        method: "POST",
        body: JSON.stringify({ action: nextAction, note: reason }),
      })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Freeze toggle failed")
    }
  }

  if (loading) return <Text>Loading…</Text>
  if (error) return <Text className="text-ui-fg-error">{error}</Text>

  return (
    <div className="flex flex-col gap-4">
      {/* Balance hero — Main + Promo side-by-side. Both buckets are
        * editable below; the bucket selector on the manual-adjust
        * form decides which one a credit/debit hits. */}
      <Container className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 flex-1">
            <div>
              <Text className="text-ui-fg-muted text-xs uppercase tracking-widest mb-1">
                Main balance
              </Text>
              <Heading level="h1">{formatInr(wallet?.balance_inr ?? 0)}</Heading>
              <Text size="xsmall" className="text-ui-fg-muted mt-1">
                Withdrawable · NEFT/IMPS-funded
              </Text>
              <div className="mt-2">
                <StatusBadge color={statusBadgeColor(wallet?.status)}>
                  {wallet?.status ?? "—"}
                </StatusBadge>
              </div>
            </div>
            <div>
              <Text className="text-ui-fg-muted text-xs uppercase tracking-widest mb-1">
                Promo balance
              </Text>
              <Heading level="h1">
                {formatInr(Number(wallet?.promo_balance_inr ?? 0))}
              </Heading>
              <Text size="xsmall" className="text-ui-fg-muted mt-1">
                Non-withdrawable · referrals + points conversion
              </Text>
            </div>
          </div>
          <Button
            variant={wallet?.status === "frozen" ? "primary" : "danger"}
            onClick={toggleFreeze}
          >
            {wallet?.status === "frozen" ? "Unfreeze wallet" : "Freeze wallet"}
          </Button>
        </div>
      </Container>

      {/* Manual adjust */}
      <Container className="p-6">
        <Heading level="h3" className="mb-3">
          Manual adjustment
        </Heading>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <Label size="small">Bucket</Label>
            <Select
              value={bucket}
              onValueChange={(v) => setBucket(v as "main" | "promo")}
            >
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="main">Main</Select.Item>
                <Select.Item value="promo">Promo</Select.Item>
              </Select.Content>
            </Select>
          </div>
          <div>
            <Label size="small">Direction</Label>
            <Select
              value={direction}
              onValueChange={(v) => setDirection(v as "credit" | "debit")}
            >
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="credit">Credit (+)</Select.Item>
                <Select.Item value="debit">Debit (−)</Select.Item>
              </Select.Content>
            </Select>
          </div>
          <div>
            <Label size="small">Amount (₹)</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 500"
            />
          </div>
          <div>
            <Label size="small">Reason code</Label>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {REASON_CODES.map((r) => (
                  <Select.Item key={r.value} value={r.value}>
                    {r.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
        </div>
        <div className="mt-3">
          <Label size="small">
            Note (min 20 chars, required) {note.length > 0 ? `— ${note.length}` : ""}
          </Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Detailed audit-friendly explanation of the adjustment."
            rows={2}
          />
        </div>
        <div className="mt-3">
          <Button
            onClick={submitAdjust}
            isLoading={adjusting}
            disabled={adjusting || !amount || note.trim().length < 20}
          >
            Apply adjustment
          </Button>
        </div>
      </Container>

      {/* Transaction ledger */}
      <Container className="p-6">
        <Heading level="h3" className="mb-3">
          Transactions ({txs.length})
        </Heading>
        {txs.length === 0 ? (
          <Text className="text-ui-fg-muted">No transactions yet.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>When</Table.HeaderCell>
                <Table.HeaderCell>Kind</Table.HeaderCell>
                <Table.HeaderCell>Bucket</Table.HeaderCell>
                <Table.HeaderCell>Dir</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Amount</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Balance after</Table.HeaderCell>
                <Table.HeaderCell>Note</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {txs.map((t) => {
                const b = t.bucket ?? "main"
                return (
                  <Table.Row key={t.id}>
                    <Table.Cell>
                      <Text size="small">{formatDate(t.created_at)}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="small">{t.kind}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <StatusBadge color={b === "promo" ? "orange" : "grey"}>
                        {b}
                      </StatusBadge>
                    </Table.Cell>
                    <Table.Cell>
                      <StatusBadge
                        color={t.direction === "credit" ? "green" : "red"}
                      >
                        {t.direction === "credit" ? "+" : "−"}
                      </StatusBadge>
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {formatInr(t.amount_inr)}
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {formatInr(t.balance_after)}
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {b} bucket
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="small" className="text-ui-fg-muted max-w-xs truncate">
                        {t.note ?? "—"}
                        {t.metadata && (t.metadata as any).reason_code ? (
                          <span className="ml-1 text-ui-fg-interactive">
                            · {(t.metadata as any).reason_code}
                          </span>
                        ) : null}
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table>
        )}
      </Container>
    </div>
  )
}
