import { useEffect, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Container,
  Heading,
  Tabs,
  Text,
  Button,
  Drawer,
  Input,
  Label,
  Textarea,
} from "@medusajs/ui"
import { User } from "@medusajs/icons"
import OverviewTab from "./tabs/OverviewTab"
import KycTab from "./tabs/KycTab"
import AccountsTab from "./tabs/AccountsTab"
import WalletTab from "./tabs/WalletTab"
import OrdersTab from "./tabs/OrdersTab"
import DocumentsTab from "./tabs/DocumentsTab"
import DepositsTab from "./tabs/DepositsTab"
import RequestsTab from "./tabs/RequestsTab"
import AuditTab from "./tabs/AuditTab"
import CustomerSearch from "../../components/CustomerSearch"
import { adminFetch } from "./helpers"

/**
 * Customer 360 — single dense admin page exposing every Polemarch-custom
 * data surface for one customer.
 *
 * Reads the target customer id from `?id=cus_XXX` in the URL. If no id
 * is present, shows a CustomerSearch picker so ops can find the customer
 * first.
 */
function Customer360Page() {
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [tab, setTab] = useState<string>("overview")

  // Parse ?id= from URL on mount and whenever it changes.
  useEffect(() => {
    const sync = () => {
      const url = new URL(window.location.href)
      setCustomerId(url.searchParams.get("id"))
    }
    sync()
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])

  const setCustomer = (id: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set("id", id)
    window.history.pushState({}, "", url.toString())
    setCustomerId(id)
  }

  if (!customerId) {
    return (
      <Container className="p-6">
        <Heading level="h1" className="mb-4">
          Customer 360
        </Heading>
        <Text className="text-ui-fg-muted mb-6">
          Search for a customer to view their full profile.
        </Text>
        <CustomerSearch
          onPick={(c) => {
            if (c?.id) setCustomer(c.id)
          }}
        />
      </Container>
    )
  }

  return (
    <Container className="p-6">
      <div className="flex items-center justify-between mb-6 gap-2">
        <Heading level="h1">Customer 360</Heading>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              const url = new URL(window.location.href)
              url.searchParams.delete("id")
              window.history.pushState({}, "", url.toString())
              setCustomerId(null)
            }}
          >
            Switch customer
          </Button>
          {/* DPDP §12 erasure trigger. Opens a typed-confirm drawer
              before firing the destructive route. Compliance-required
              rows (orders, pan_record, aadhaar_record, bank_record,
              wallet ledger, audit logs) are preserved by the route's
              underlying scrub utility — see
              /utils/dpdp/hard-delete-customer.ts for the contract. */}
          <HardDeleteButton
            customerId={customerId}
            onDeleted={() => {
              const url = new URL(window.location.href)
              url.searchParams.delete("id")
              window.history.pushState({}, "", url.toString())
              setCustomerId(null)
            }}
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <Tabs.List className="mb-4 flex-wrap">
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger value="kyc">KYC</Tabs.Trigger>
          <Tabs.Trigger value="accounts">Bank & Demat</Tabs.Trigger>
          <Tabs.Trigger value="wallet">Wallet</Tabs.Trigger>
          <Tabs.Trigger value="orders">Orders</Tabs.Trigger>
          <Tabs.Trigger value="documents">Documents</Tabs.Trigger>
          <Tabs.Trigger value="deposits">Deposits</Tabs.Trigger>
          <Tabs.Trigger value="requests">Company requests</Tabs.Trigger>
          <Tabs.Trigger value="audit">Audit log</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="overview">
          <OverviewTab customerId={customerId} />
        </Tabs.Content>
        <Tabs.Content value="kyc">
          <KycTab customerId={customerId} />
        </Tabs.Content>
        <Tabs.Content value="accounts">
          <AccountsTab customerId={customerId} />
        </Tabs.Content>
        <Tabs.Content value="wallet">
          <WalletTab customerId={customerId} />
        </Tabs.Content>
        <Tabs.Content value="orders">
          <OrdersTab customerId={customerId} />
        </Tabs.Content>
        <Tabs.Content value="documents">
          <DocumentsTab customerId={customerId} />
        </Tabs.Content>
        <Tabs.Content value="deposits">
          <DepositsTab customerId={customerId} />
        </Tabs.Content>
        <Tabs.Content value="requests">
          <RequestsTab customerId={customerId} />
        </Tabs.Content>
        <Tabs.Content value="audit">
          <AuditTab customerId={customerId} />
        </Tabs.Content>
      </Tabs>
    </Container>
  )
}

/**
 * Destructive button + typed-confirm drawer that fires the
 * `POST /admin/customers/:id/hard-delete` route. The route under-the-hood
 * runs the DPDP scrub (PII tombstoning across all customer-bound rows),
 * deletes the customer's auth_identity (login disabled), and soft-deletes
 * the customer row. Orders, pan_record, aadhaar_record, bank_record,
 * wallet ledger, and admin_audit_log are PRESERVED for the 8-year SEBI /
 * DPDP retention schedule.
 *
 * Two-stage confirm:
 *   1. The button opens a drawer.
 *   2. Inside, ops must (a) type the customer's exact email + (b) supply
 *      a 4–500 char reason. Submit is disabled until both pass.
 *
 * On success, ops is bounced back to the customer-search screen.
 */
function HardDeleteButton({
  customerId,
  onDeleted,
}: {
  customerId: string
  onDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [customerEmail, setCustomerEmail] = useState<string | null>(null)
  const [confirmEmail, setConfirmEmail] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<unknown>(null)

  // Fetch the customer's current email when the drawer opens — needed
  // for the type-to-confirm guard. We deliberately re-fetch each open
  // (don't cache) so a customer rename between renders doesn't allow a
  // stale match through.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    setReport(null)
    setConfirmEmail("")
    setReason("")
    ;(async () => {
      try {
        const r = await adminFetch<{ customer?: { email?: string } }>(
          `/admin/customers/${customerId}?fields=email`,
        )
        if (cancelled) return
        setCustomerEmail((r?.customer?.email as string) ?? null)
      } catch (e) {
        if (!cancelled) {
          setCustomerEmail(null)
          setError(
            e instanceof Error ? e.message : "Could not load customer email",
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, customerId])

  const emailMatches =
    !!customerEmail &&
    confirmEmail.trim().toLowerCase() === customerEmail.toLowerCase()
  const reasonOk = reason.trim().length >= 4 && reason.trim().length <= 500
  const canSubmit = emailMatches && reasonOk && !busy && !report

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await adminFetch<{ ok: boolean; report: unknown }>(
        `/admin/customers/${customerId}/hard-delete`,
        {
          method: "POST",
          body: JSON.stringify({
            confirm_email: confirmEmail.trim().toLowerCase(),
            reason: reason.trim(),
          }),
        },
      )
      setReport(r.report)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Hard delete failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        variant="danger"
        size="small"
        onClick={() => setOpen(true)}
        title="DPDP erasure — disables login, scrubs PII, preserves orders + pan_record + aadhaar_record"
      >
        Hard delete
      </Button>
      <Drawer open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Hard delete customer</Drawer.Title>
            <Drawer.Description>
              DPDP §12 right-to-erasure. Disables login, tombstones every
              piece of customer-bound PII. <strong>Preserved</strong>:
              orders + amounts + ISIN + dates (SEBI 8-year retention),
              pan_record + aadhaar_record + bank_record (compliance),
              wallet ledger, admin audit log.
            </Drawer.Description>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
            {report ? (
              <div className="space-y-2">
                <Text className="text-ui-fg-interactive font-semibold">
                  Done. Customer hard-deleted.
                </Text>
                <Text className="text-ui-fg-muted text-xs">
                  Login disabled, PII scrubbed across all customer-bound
                  tables, customer row soft-deleted. Orders + pan_record
                  + aadhaar_record retained.
                </Text>
                <pre className="overflow-auto rounded-md border border-ui-border-base bg-ui-bg-subtle p-3 text-xs">
                  {JSON.stringify(report, null, 2)}
                </pre>
              </div>
            ) : (
              <>
                <div>
                  <Label className="block mb-1 text-xs font-semibold">
                    Customer&apos;s current email
                  </Label>
                  <Text className="text-ui-fg-muted text-sm">
                    {customerEmail ?? "(loading…)"}
                  </Text>
                </div>
                <div>
                  <Label htmlFor="hd-confirm-email" className="block mb-1">
                    Type the email above to confirm
                  </Label>
                  <Input
                    id="hd-confirm-email"
                    value={confirmEmail}
                    onChange={(e) => setConfirmEmail(e.target.value)}
                    placeholder="exact@email.com"
                    autoComplete="off"
                    disabled={busy}
                  />
                  {confirmEmail && !emailMatches && (
                    <Text className="text-ui-fg-error text-xs mt-1">
                      Doesn&apos;t match.
                    </Text>
                  )}
                </div>
                <div>
                  <Label htmlFor="hd-reason" className="block mb-1">
                    Reason (4–500 chars; goes into admin audit log)
                  </Label>
                  <Textarea
                    id="hd-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. customer-requested erasure under DPDP §12 — ticket #1234"
                    rows={3}
                    disabled={busy}
                  />
                </div>
                {error && (
                  <Text className="text-ui-fg-error text-xs">{error}</Text>
                )}
              </>
            )}
          </Drawer.Body>
          <Drawer.Footer>
            {report ? (
              <Button
                variant="primary"
                onClick={() => {
                  setOpen(false)
                  onDeleted()
                }}
              >
                Close
              </Button>
            ) : (
              <>
                <Drawer.Close asChild>
                  <Button variant="secondary" disabled={busy}>
                    Cancel
                  </Button>
                </Drawer.Close>
                <Button
                  variant="danger"
                  onClick={submit}
                  disabled={!canSubmit}
                  isLoading={busy}
                >
                  Hard delete
                </Button>
              </>
            )}
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </>
  )
}

export const config = defineRouteConfig({
  label: "Customer 360",
  icon: User,
  // Sidebar nest under the native Customers menu — alongside
  // "Customer Groups". Medusa Admin SDK only allows nesting under
  // a fixed set of native routes (/orders, /products, /inventory,
  // /customers, /promotions, /price-lists), so we can't make
  // Customer 360 itself a parent.
  nested: "/customers",
})

export default Customer360Page
