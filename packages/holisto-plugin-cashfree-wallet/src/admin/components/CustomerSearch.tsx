import { useEffect, useRef, useState } from "react"
import { Input, Text } from "@medusajs/ui"

/**
 * Customer typeahead used by the admin Wallet page's "Customer wallet"
 * tab. Queries Medusa's core admin customers endpoint
 * (`GET /admin/customers?q=&limit=`) and calls `onPick` with the chosen
 * customer.
 *
 * This is a plugin-owned reimplementation of the host app's
 * `components/CustomerSearch` (which was not part of the shared slice).
 * It relies only on the standard Medusa admin API, so it works in any
 * install.
 */
export type PickedCustomer = {
  id: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
}

type Props = {
  onPick: (customer: PickedCustomer) => void
  placeholder?: string
}

export default function CustomerSearch({ onPick, placeholder }: Props) {
  const [term, setTerm] = useState("")
  const [results, setResults] = useState<PickedCustomer[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  // debounce the query
  useEffect(() => {
    const q = term.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `/admin/customers?q=${encodeURIComponent(q)}&limit=8`,
          { credentials: "include" }
        )
        const body = await res.json()
        if (!cancelled) {
          setResults(Array.isArray(body?.customers) ? body.customers : [])
          setOpen(true)
        }
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [term])

  // close on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  return (
    <div ref={boxRef} className="relative flex-1">
      <Input
        value={term}
        placeholder={
          placeholder ?? "Search by email, name, phone, or cus_… id"
        }
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {open && (loading || results.length > 0) && (
        <div className="absolute z-50 mt-1 max-h-80 w-full overflow-auto rounded-md border border-ui-border-base bg-ui-bg-base shadow-elevation-flyout">
          {loading && (
            <div className="px-3 py-2">
              <Text size="small" className="text-ui-fg-muted">
                Searching…
              </Text>
            </div>
          )}
          {!loading &&
            results.map((c) => {
              const name =
                [c.first_name, c.last_name].filter(Boolean).join(" ") || "—"
              const contact = [c.email, c.phone].filter(Boolean).join(" · ")
              return (
                <button
                  key={c.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-ui-bg-base-hover"
                  onClick={() => {
                    onPick(c)
                    setTerm(name)
                    setOpen(false)
                  }}
                >
                  <span className="min-w-0">
                    <Text size="small" weight="plus" className="truncate">
                      {name}
                    </Text>
                    <Text size="xsmall" className="truncate text-ui-fg-muted">
                      {contact}
                    </Text>
                  </span>
                  <code className="shrink-0 text-xs text-ui-fg-muted">
                    {c.id}
                  </code>
                </button>
              )
            })}
        </div>
      )}
    </div>
  )
}
