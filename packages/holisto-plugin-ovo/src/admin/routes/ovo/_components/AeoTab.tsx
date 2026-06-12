import React, { useEffect, useState } from "react"
import {
  Button,
  Heading,
  Input,
  Label,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import {
  loadOvo,
  saveOvo,
  type CitationsConfig,
  type FaqEntry,
  type OvoSettingView,
} from "./types"

/**
 * AEO tab — three scopes of FAQ JSON-LD plus E-E-A-T defaults.
 *
 * FAQ scopes (cascade applied by the storefront, NOT merged at storage):
 *   - Brand FAQ      (`faq`)                  — emitted by `<FaqSchema/>`
 *   - Default product FAQ (`default_product_faq`)
 *                                              — fallback for /products/[id]
 *   - Default category FAQ (`default_category_faq`)
 *                                              — fallback for category pages
 *
 * Per-product / per-category overrides (in `ovo_override`) supersede
 * the defaults; an override can opt to MERGE with the default by
 * flipping `inherit_default_faq` on the override row.
 *
 * E-E-A-T fallbacks (author / reviewer / last_updated) are also
 * managed here.
 */
const AeoTab: React.FC = () => {
  const [draft, setDraft] = useState<OvoSettingView | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadOvo()
      .then(setDraft)
      .catch((err) =>
        toast.error("Load failed", { description: (err as Error).message }),
      )
      .finally(() => setLoading(false))
  }, [])

  if (loading || !draft) return <Text>Loading…</Text>

  const cites: CitationsConfig =
    draft.citations ?? { author: "", reviewer: "", last_updated: "" }

  const setCites = (patch: Partial<CitationsConfig>) =>
    setDraft({ ...draft, citations: { ...cites, ...patch } })

  const save = async () => {
    setSaving(true)
    try {
      const next = await saveOvo({
        faq: draft.faq ?? [],
        default_product_faq: draft.default_product_faq ?? [],
        default_category_faq: draft.default_category_faq ?? [],
        citations: cites,
      })
      setDraft(next)
      toast.success("Saved")
    } catch (err) {
      toast.error("Save failed", { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <FaqEditor
        title="Brand FAQs (site-wide)"
        hint="Emitted on pages that mount the brand FaqSchema (currently /how-it-works). Brand-level questions only — not duplicated onto product/category pages by default."
        items={draft.faq ?? []}
        setItems={(next) => setDraft({ ...draft, faq: next })}
      />

      <FaqEditor
        title="Default product FAQs"
        hint="Fallback FAQ for every /products/[id] page that doesn't have its own override. Per-product overrides REPLACE these by default; admins can opt-in to merge via the override's 'Inherit defaults' toggle."
        items={draft.default_product_faq ?? []}
        setItems={(next) => setDraft({ ...draft, default_product_faq: next })}
      />

      <FaqEditor
        title="Default category FAQs"
        hint="Fallback FAQ for every category page that doesn't have its own override. Same merge semantics as default product FAQs."
        items={draft.default_category_faq ?? []}
        setItems={(next) =>
          setDraft({ ...draft, default_category_faq: next })
        }
      />

      <section className="flex flex-col gap-3">
        <Heading level="h2">E-E-A-T defaults</Heading>
        <Text className="text-ui-fg-muted">
          Used by content pages (e.g. knowledge articles, /methodology)
          that don't carry their own attribution.
        </Text>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="author">Author</Label>
            <Input
              id="author"
              value={cites.author ?? ""}
              onChange={(e) => setCites({ author: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="reviewer">Reviewer</Label>
            <Input
              id="reviewer"
              value={cites.reviewer ?? ""}
              onChange={(e) => setCites({ reviewer: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="last_updated">Last updated (ISO date)</Label>
            <Input
              id="last_updated"
              placeholder="2026-05-06"
              value={cites.last_updated ?? ""}
              onChange={(e) => setCites({ last_updated: e.target.value })}
            />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={save} isLoading={saving}>
          Save AEO settings
        </Button>
      </div>
    </div>
  )
}

/**
 * Reusable FAQ editor block — same affordances as the per-entity
 * override form's FAQ section. Centralised here so adding/renaming
 * FAQ scopes only touches one component.
 */
function FaqEditor({
  title,
  hint,
  items,
  setItems,
}: {
  title: string
  hint: string
  items: FaqEntry[]
  setItems: (next: FaqEntry[]) => void
}) {
  const add = () => setItems([...items, { question: "", answer: "" }])
  const update = (i: number, patch: Partial<FaqEntry>) => {
    const next = items.slice()
    next[i] = { ...next[i], ...patch }
    setItems(next)
  }
  const remove = (i: number) => {
    const next = items.slice()
    next.splice(i, 1)
    setItems(next)
  }

  return (
    <section className="flex flex-col gap-3">
      <Heading level="h2">{title}</Heading>
      <Text className="text-ui-fg-muted">{hint}</Text>
      {items.map((entry, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-lg border border-ui-border-base p-3"
        >
          <Input
            placeholder="Question"
            value={entry.question}
            onChange={(e) => update(i, { question: e.target.value })}
          />
          <Textarea
            rows={3}
            placeholder="Answer (under 300 chars)"
            value={entry.answer}
            onChange={(e) => update(i, { answer: e.target.value })}
          />
          <div className="flex justify-end">
            <Button
              variant="transparent"
              size="small"
              onClick={() => remove(i)}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button variant="secondary" onClick={add}>
          + Add FAQ
        </Button>
      </div>
    </section>
  )
}

export default AeoTab
