import React, { useEffect, useState } from "react"
import {
  Badge,
  Button,
  Heading,
  Input,
  Label,
  Text,
  toast,
} from "@medusajs/ui"
import { Trash } from "@medusajs/icons"
import { OvoOverrideForm } from "../../../components/OvoOverrideForm"

/**
 * Pages tab — manages path-keyed OVO overrides for marketing /
 * knowledge / static pages that don't have a Medusa entity behind
 * them.
 *
 * UX:
 *   - List view: every override row of `entity_type=page`, sorted by
 *     path. Click a row → open the same `OvoOverrideForm` used by
 *     product/category widgets, scoped to that path.
 *   - "Add path" input: type a URL path (e.g. `/pricing`), submit →
 *     opens the form for that path (POST creates it on save).
 *
 * Storefront pages opt-in to applying these overrides by mounting
 * `<PageOverrideSchema path="/pricing" />`. The path-keyed override
 * is fetched on render and emits FAQ + custom JSON-LD.
 */

type ListedOverride = {
  id: string
  entity_id: string
  seo_title: string | null
  noindex: boolean
  faq: { question: string; answer: string }[] | null
  custom_json_ld: unknown[] | null
  updated_at?: string | null
}

const LIST_API = "/admin/ovo/overrides/page"

const PagesTab: React.FC = () => {
  const [rows, setRows] = useState<ListedOverride[]>([])
  const [loading, setLoading] = useState(true)
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [newPath, setNewPath] = useState("")
  const [deletingPath, setDeletingPath] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true)
    try {
      const r = await fetch(LIST_API, { credentials: "include" })
      if (!r.ok) {
        throw new Error(`Load failed (${r.status})`)
      }
      const body = (await r.json()) as { overrides: ListedOverride[] }
      setRows(body.overrides ?? [])
    } catch (err) {
      toast.error("Failed to load page overrides", {
        description: (err as Error).message,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  if (editingPath) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Heading level="h2">
            Page overrides — <code className="font-mono text-sm">{editingPath}</code>
          </Heading>
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              setEditingPath(null)
              reload()
            }}
          >
            ← Back to list
          </Button>
        </div>
        <OvoOverrideForm
          entity_type="page"
          entity_id={editingPath}
          entity_label={editingPath}
        />
      </div>
    )
  }

  const deletePath = async (entityId: string) => {
    if (
      !confirm(
        `Delete the OVO override for "${entityId}"? The path will revert to brand defaults.`,
      )
    ) {
      return
    }
    setDeletingPath(entityId)
    try {
      const r = await fetch(
        `/admin/ovo/overrides/page/${encodeURIComponent(entityId)}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      )
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { message?: string }
        throw new Error(e.message || `Delete failed (${r.status})`)
      }
      toast.success(`Deleted override for ${entityId}`)
      await reload()
    } catch (err) {
      toast.error("Delete failed", { description: (err as Error).message })
    } finally {
      setDeletingPath(null)
    }
  }

  const submitNewPath = () => {
    const p = newPath.trim()
    if (!p) return
    if (!p.startsWith("/")) {
      toast.error("Path must start with '/'", {
        description: `Got "${p}". Use e.g. "/pricing" or "/knowledge".`,
      })
      return
    }
    setEditingPath(p)
    setNewPath("")
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <Heading level="h2">Page overrides</Heading>
        <Text className="text-ui-fg-muted">
          Per-page customisation for marketing / knowledge / static
          pages. Storefront pages opt-in by mounting{" "}
          <code className="font-mono text-xs">
            &lt;PageOverrideSchema path="/&lt;path&gt;" /&gt;
          </code>
          . The override is keyed by URL path (e.g.{" "}
          <code className="font-mono text-xs">/pricing</code>,{" "}
          <code className="font-mono text-xs">/about</code>).
        </Text>
      </section>

      <section className="flex flex-col gap-2">
        <Label htmlFor="new_path">Add a new page override</Label>
        <div className="flex items-center gap-2">
          <Input
            id="new_path"
            placeholder="/pricing"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNewPath()
            }}
          />
          <Button onClick={submitNewPath}>+ Open editor</Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading level="h3">Existing overrides ({rows.length})</Heading>
        {loading && <Text>Loading…</Text>}
        {!loading && rows.length === 0 && (
          <Text className="text-ui-fg-muted">
            No page overrides yet. Add one above.
          </Text>
        )}
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex flex-col gap-1 rounded-lg border border-ui-border-base bg-ui-bg-base p-3 transition-colors hover:bg-ui-bg-base-hover"
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setEditingPath(r.entity_id)}
                className="flex flex-1 items-center gap-2 text-left"
              >
                <code className="font-mono text-sm font-bold">
                  {r.entity_id}
                </code>
                <div className="flex items-center gap-1.5">
                  {r.noindex && <Badge color="orange">noindex</Badge>}
                  {Array.isArray(r.faq) && r.faq.length > 0 && (
                    <Badge color="blue">FAQ ×{r.faq.length}</Badge>
                  )}
                  {Array.isArray(r.custom_json_ld) &&
                    r.custom_json_ld.length > 0 && (
                      <Badge color="purple">
                        JSON-LD ×{r.custom_json_ld.length}
                      </Badge>
                    )}
                </div>
              </button>
              {/* Per-row delete keeps stale overrides from collecting. The
                 delete soft-removes the row (entity_type='page'); the
                 path falls back to brand defaults next render. */}
              <Button
                size="small"
                variant="transparent"
                onClick={(e) => {
                  e.stopPropagation()
                  deletePath(r.entity_id)
                }}
                isLoading={deletingPath === r.entity_id}
                disabled={deletingPath !== null}
                aria-label={`Delete override for ${r.entity_id}`}
              >
                <Trash className="h-3 w-3" />
              </Button>
            </div>
            {r.seo_title && (
              <button
                type="button"
                onClick={() => setEditingPath(r.entity_id)}
                className="text-left"
              >
                <Text size="small" className="text-ui-fg-subtle">
                  {r.seo_title}
                </Text>
              </button>
            )}
          </div>
        ))}
      </section>
    </div>
  )
}

export default PagesTab
