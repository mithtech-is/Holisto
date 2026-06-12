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
  type EntityConfig,
  type OvoSettingView,
} from "./types"

/**
 * Entity & KG tab — sameAs URLs (social profiles, Wikidata, etc.),
 * knowsAbout topics (the brand's claimed authority surface), and
 * services (rendered as the LocalBusiness `hasOfferCatalog`).
 *
 * The sameAs list is the single most important entity-engine signal
 * — Google's knowledge graph uses it to merge the brand into one
 * canonical entity rather than fragmented social profiles.
 */
const EntityKgTab: React.FC = () => {
  const [draft, setDraft] = useState<OvoSettingView | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadOvo()
      .then(setDraft)
      .catch((err) => toast.error("Load failed", { description: (err as Error).message }))
      .finally(() => setLoading(false))
  }, [])

  if (loading || !draft) return <Text>Loading…</Text>

  const entity: EntityConfig =
    draft.entity ?? { same_as: [], knows_about: [], services: [] }

  const setEntity = (patch: Partial<EntityConfig>) =>
    setDraft({ ...draft, entity: { ...entity, ...patch } })

  const addService = () =>
    setEntity({
      services: [...entity.services, { name: "", description: "", url: "" }],
    })
  const updateService = (i: number, patch: Partial<EntityConfig["services"][0]>) => {
    const next = entity.services.slice()
    next[i] = { ...next[i], ...patch }
    setEntity({ services: next })
  }
  const removeService = (i: number) => {
    const next = entity.services.slice()
    next.splice(i, 1)
    setEntity({ services: next })
  }

  const save = async () => {
    setSaving(true)
    try {
      const next = await saveOvo({ entity })
      setDraft(next)
      toast.success("Saved")
    } catch (err) {
      toast.error("Save failed", { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Heading level="h2">sameAs links</Heading>
        <Text className="text-ui-fg-muted">
          Verified profiles + entity refs (LinkedIn, Twitter, Wikidata,
          Crunchbase). One URL per line.
        </Text>
        <Textarea
          rows={6}
          value={entity.same_as.join("\n")}
          onChange={(e) =>
            setEntity({
              same_as: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </section>

      <section className="flex flex-col gap-3">
        <Heading level="h2">knowsAbout topics</Heading>
        <Text className="text-ui-fg-muted">
          Topic entities the brand claims authority on. One per line —
          mirror the topics covered by knowledge-base content.
        </Text>
        <Textarea
          rows={8}
          value={entity.knows_about.join("\n")}
          onChange={(e) =>
            setEntity({
              knows_about: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </section>

      <section className="flex flex-col gap-3">
        <Heading level="h2">Service catalog</Heading>
        <Text className="text-ui-fg-muted">
          Rendered as `hasOfferCatalog` inside the LocalBusiness graph.
        </Text>
        {entity.services.map((s, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-lg border border-ui-border-base p-3"
          >
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label>Name</Label>
                <Input
                  value={s.name}
                  onChange={(e) => updateService(i, { name: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>URL</Label>
                <Input
                  value={s.url ?? ""}
                  onChange={(e) => updateService(i, { url: e.target.value })}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={s.description ?? ""}
                onChange={(e) =>
                  updateService(i, { description: e.target.value })
                }
              />
            </div>
            <div className="flex justify-end">
              <Button
                variant="transparent"
                size="small"
                onClick={() => removeService(i)}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button variant="secondary" onClick={addService}>
            + Add service
          </Button>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={save} isLoading={saving}>
          Save Entity / KG settings
        </Button>
      </div>
    </div>
  )
}

export default EntityKgTab
