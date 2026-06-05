import React, { useEffect, useState } from "react"
import {
  Button,
  Heading,
  Input,
  Label,
  Switch,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import {
  loadOvo,
  saveOvo,
  type Brand,
  type ContactPoint,
  type DefaultMeta,
  type Founder,
  type OvoSettingView,
  type PressMention,
} from "./types"

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]

/**
 * General tab — master + per-channel toggles, brand identity, and
 * site-wide meta defaults.
 *
 * Brand identity is the single source for the Organization JSON-LD
 * graph that ships on every storefront page; meta defaults fill any
 * page-level metadata that's not explicitly set in `pageMeta.ts`.
 */
const CHANNEL_TOGGLES: Array<{
  key: keyof OvoSettingView
  label: string
  hint: string
}> = [
  { key: "seo_enabled", label: "SEO (search engines)", hint: "Robots, sitemap shards, meta defaults." },
  { key: "geo_enabled", label: "GEO (Generative Engine)", hint: "Summary paragraphs, intent keywords, source attribution." },
  { key: "aeo_enabled", label: "AEO (Answer Engine)", hint: "Site-wide FAQ JSON-LD + E-E-A-T fields." },
  { key: "llmo_enabled", label: "LLMO (LLM Optimization)", hint: "/llms.txt content + per-bot allow/deny." },
  { key: "eeo_enabled", label: "EEO (Entity Engine)", hint: "sameAs links + knowsAbout topics for disambiguation." },
  { key: "kgo_enabled", label: "KGO (Knowledge Graph)", hint: "Organization + LocalBusiness JSON-LD emission." },
  { key: "reo_enabled", label: "REO (Retrieval Engine)", hint: "Chunking hints + JSONL export flag for RAG consumers." },
  { key: "sgeo_enabled", label: "SGEO (Search Generative Experience)", hint: "AI-overview shaping; same data store as GEO." },
]

const GeneralTab: React.FC = () => {
  const [view, setView] = useState<OvoSettingView | null>(null)
  const [draft, setDraft] = useState<OvoSettingView | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadOvo()
      .then((v) => {
        setView(v)
        setDraft(v)
      })
      .catch((err) => toast.error("Load failed", { description: (err as Error).message }))
      .finally(() => setLoading(false))
  }, [])

  if (loading || !draft) return <Text>Loading…</Text>

  const brand: Brand =
    draft.brand ?? {
      name: "",
      alt_names: [],
      legal_name: "",
      slogan: "",
      description: "",
      logo_url: "",
      founding_year: "",
      founding_place: "",
      parent_org: null,
      contact_points: [],
      postal_address: null,
      founders: [],
      press_mentions: [],
    }
  const meta: DefaultMeta =
    draft.default_meta ?? {
      title_default: "",
      title_template: "%s",
      description_fallback: "",
      keywords: [],
      og_image_url: null,
      twitter_handle: null,
      locale: "en_IN",
    }

  const setBrand = (patch: Partial<Brand>) =>
    setDraft({ ...draft, brand: { ...brand, ...patch } })
  const setMeta = (patch: Partial<DefaultMeta>) =>
    setDraft({ ...draft, default_meta: { ...meta, ...patch } })

  const contactPoints = brand.contact_points ?? []
  const updateContact = (i: number, patch: Partial<ContactPoint>) => {
    const next = contactPoints.slice()
    next[i] = { ...next[i], ...patch }
    setBrand({ contact_points: next })
  }
  const addContact = () =>
    setBrand({
      contact_points: [
        ...contactPoints,
        {
          contact_type: "customer support",
          telephone: "",
          email: "",
          area_served: "IN",
          available_language: ["en"],
          hours: null,
        },
      ],
    })
  const removeContact = (i: number) => {
    const next = contactPoints.slice()
    next.splice(i, 1)
    setBrand({ contact_points: next })
  }
  const toggleContactDay = (i: number, day: string) => {
    const cp = contactPoints[i]
    const hours =
      cp.hours ??
      ({ days: [], opens: "10:00", closes: "19:00" } as NonNullable<ContactPoint["hours"]>)
    const days = hours.days.includes(day)
      ? hours.days.filter((d) => d !== day)
      : [...hours.days, day]
    updateContact(i, { hours: { ...hours, days } })
  }

  const founders: Founder[] = brand.founders ?? []
  const updateFounder = (i: number, patch: Partial<Founder>) => {
    const next = founders.slice()
    next[i] = { ...next[i], ...patch }
    setBrand({ founders: next })
  }
  const addFounder = () =>
    setBrand({
      founders: [
        ...founders,
        { name: "", role: "", bio: "", photo_url: "", linkedin_url: "" },
      ],
    })
  const removeFounder = (i: number) => {
    const next = founders.slice()
    next.splice(i, 1)
    setBrand({ founders: next })
  }

  const press: PressMention[] = brand.press_mentions ?? []
  const updatePress = (i: number, patch: Partial<PressMention>) => {
    const next = press.slice()
    next[i] = { ...next[i], ...patch }
    setBrand({ press_mentions: next })
  }
  const addPress = () =>
    setBrand({
      press_mentions: [
        ...press,
        { publication: "", headline: "", url: "", date: null, logo_url: null },
      ],
    })
  const removePress = (i: number) => {
    const next = press.slice()
    next.splice(i, 1)
    setBrand({ press_mentions: next })
  }

  const addr = brand.postal_address ?? null
  const setAddr = (
    patch: Partial<NonNullable<Brand["postal_address"]>>,
  ) =>
    setBrand({
      postal_address: {
        street: addr?.street ?? "",
        city: addr?.city ?? "",
        region: addr?.region ?? "",
        postal_code: addr?.postal_code ?? "",
        country: addr?.country ?? "",
        ...patch,
      },
    })

  const save = async () => {
    setSaving(true)
    try {
      const next = await saveOvo({
        master_enabled: draft.master_enabled,
        seo_enabled: draft.seo_enabled,
        geo_enabled: draft.geo_enabled,
        aeo_enabled: draft.aeo_enabled,
        llmo_enabled: draft.llmo_enabled,
        eeo_enabled: draft.eeo_enabled,
        kgo_enabled: draft.kgo_enabled,
        reo_enabled: draft.reo_enabled,
        sgeo_enabled: draft.sgeo_enabled,
        brand,
        default_meta: meta,
      })
      setView(next)
      setDraft(next)
      toast.success("Saved", {
        description: "Storefront cache is being refreshed in the background.",
      })
    } catch (err) {
      toast.error("Save failed", { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <Heading level="h2">Channel toggles</Heading>
        <Text className="text-ui-fg-muted">
          The master switch is the kill-switch — when off, every visibility
          surface short-circuits. Per-channel toggles let you dark-launch
          individual surfaces (e.g. flip LLMO on but leave GEO off until
          summary copy is ready).
        </Text>

        <div className="flex items-center gap-3 border-b border-ui-border-base pb-4">
          <Switch
            checked={draft.master_enabled}
            onCheckedChange={(checked) =>
              setDraft({ ...draft, master_enabled: !!checked })
            }
            id="master_enabled"
          />
          <div>
            <Label htmlFor="master_enabled" className="font-bold">
              Master switch — Online Visibility Optimization
            </Label>
            <Text size="small" className="text-ui-fg-muted">
              Controls every channel below. Off = behave like the pre-OVO
              storefront defaults (no JSON-LD, no /llms.txt, no FAQ schema).
            </Text>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {CHANNEL_TOGGLES.map(({ key, label, hint }) => (
            <div key={key} className="flex items-start gap-3">
              <Switch
                checked={!!draft[key]}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, [key]: !!checked } as OvoSettingView)
                }
                id={key as string}
                disabled={!draft.master_enabled}
              />
              <div>
                <Label htmlFor={key as string}>{label}</Label>
                <Text size="small" className="text-ui-fg-muted">
                  {hint}
                </Text>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading level="h2">Brand identity</Heading>
        <Text className="text-ui-fg-muted">
          Drives the Organization JSON-LD graph + every fallback meta value.
        </Text>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="brand_name">Brand name</Label>
            <Input
              id="brand_name"
              value={brand.name}
              onChange={(e) => setBrand({ name: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="legal_name">Legal name</Label>
            <Input
              id="legal_name"
              value={brand.legal_name}
              onChange={(e) => setBrand({ legal_name: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="alt_names">Alternate names (comma-separated)</Label>
            <Input
              id="alt_names"
              value={brand.alt_names.join(", ")}
              onChange={(e) =>
                setBrand({
                  alt_names: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="logo_url">Logo URL</Label>
            <Input
              id="logo_url"
              value={brand.logo_url}
              onChange={(e) => setBrand({ logo_url: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="slogan">Slogan</Label>
            <Input
              id="slogan"
              value={brand.slogan}
              onChange={(e) => setBrand({ slogan: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={3}
              value={brand.description}
              onChange={(e) => setBrand({ description: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="founding_year">Founding year</Label>
            <Input
              id="founding_year"
              value={brand.founding_year}
              onChange={(e) => setBrand({ founding_year: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="founding_place">Founding place</Label>
            <Input
              id="founding_place"
              value={brand.founding_place}
              onChange={(e) => setBrand({ founding_place: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="parent_name">Parent organization name</Label>
            <Input
              id="parent_name"
              value={brand.parent_org?.name ?? ""}
              onChange={(e) =>
                setBrand({
                  parent_org: {
                    name: e.target.value,
                    url: brand.parent_org?.url ?? "",
                  },
                })
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="parent_url">Parent organization URL</Label>
            <Input
              id="parent_url"
              value={brand.parent_org?.url ?? ""}
              onChange={(e) =>
                setBrand({
                  parent_org: {
                    name: brand.parent_org?.name ?? "",
                    url: e.target.value,
                  },
                })
              }
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading level="h2">Postal address</Heading>
        <Text className="text-ui-fg-muted">
          Used in the LocalBusiness JSON-LD graph + the Organization
          contact info. Also feeds `geo.placename` in head meta.
        </Text>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="addr_street">Street</Label>
            <Input
              id="addr_street"
              value={addr?.street ?? ""}
              onChange={(e) => setAddr({ street: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="addr_city">City</Label>
            <Input
              id="addr_city"
              value={addr?.city ?? ""}
              onChange={(e) => setAddr({ city: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="addr_region">State / Region</Label>
            <Input
              id="addr_region"
              value={addr?.region ?? ""}
              onChange={(e) => setAddr({ region: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="addr_postal">Postal code</Label>
            <Input
              id="addr_postal"
              value={addr?.postal_code ?? ""}
              onChange={(e) => setAddr({ postal_code: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="addr_country">Country (ISO 3166 alpha-2)</Label>
            <Input
              id="addr_country"
              placeholder="IN"
              value={addr?.country ?? ""}
              onChange={(e) => setAddr({ country: e.target.value })}
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading level="h2">Founders</Heading>
        <Text className="text-ui-fg-muted">
          Named founders are emitted as <code className="font-mono text-xs">Person</code>{" "}
          nodes inside the Organization JSON-LD graph (boosts Knowledge Graph signal
          + E-E-A-T) AND rendered in the homepage Founder strip. Leave empty until
          you have real names + photos — the strip auto-hides for an empty list,
          so it never ships as a stub.
        </Text>
        {founders.map((f, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border border-ui-border-base p-3"
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label>Name</Label>
                <Input
                  placeholder="Full name"
                  value={f.name}
                  onChange={(e) => updateFounder(i, { name: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Role</Label>
                <Input
                  placeholder="Founder & CEO"
                  value={f.role}
                  onChange={(e) => updateFounder(i, { role: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <Label>Bio (1-2 lines)</Label>
                <Textarea
                  rows={2}
                  placeholder="Previously at … . Built …"
                  value={f.bio}
                  onChange={(e) => updateFounder(i, { bio: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Photo URL</Label>
                <Input
                  placeholder="/assets/founders/jane.jpg or absolute URL"
                  value={f.photo_url}
                  onChange={(e) =>
                    updateFounder(i, { photo_url: e.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>LinkedIn URL</Label>
                <Input
                  placeholder="https://www.linkedin.com/in/…"
                  value={f.linkedin_url}
                  onChange={(e) =>
                    updateFounder(i, { linkedin_url: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                variant="transparent"
                size="small"
                onClick={() => removeFounder(i)}
              >
                Remove founder
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button variant="secondary" onClick={addFounder}>
            + Add founder
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading level="h2">Press mentions</Heading>
        <Text className="text-ui-fg-muted">
          "As seen in" wall — one entry per news article that mentions
          your brand by name. Becomes the homepage Press strip (auto-hides
          when empty) and is emitted as Organization{" "}
          <code className="font-mono text-xs">subjectOf: NewsArticle</code>{" "}
          for retrievers.
        </Text>
        {press.map((p, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border border-ui-border-base p-3"
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label>Publication</Label>
                <Input
                  placeholder="Economic Times"
                  value={p.publication}
                  onChange={(e) =>
                    updatePress(i, { publication: e.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Date (ISO, optional)</Label>
                <Input
                  placeholder="2026-05-14"
                  value={p.date ?? ""}
                  onChange={(e) =>
                    updatePress(i, { date: e.target.value || null })
                  }
                />
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <Label>Headline</Label>
                <Input
                  placeholder="Article headline"
                  value={p.headline}
                  onChange={(e) =>
                    updatePress(i, { headline: e.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <Label>URL</Label>
                <Input
                  placeholder="https://economictimes…"
                  value={p.url}
                  onChange={(e) => updatePress(i, { url: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <Label>Publication logo URL (optional)</Label>
                <Input
                  placeholder="/assets/press/et.svg"
                  value={p.logo_url ?? ""}
                  onChange={(e) =>
                    updatePress(i, { logo_url: e.target.value || null })
                  }
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                variant="transparent"
                size="small"
                onClick={() => removePress(i)}
              >
                Remove mention
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button variant="secondary" onClick={addPress}>
            + Add press mention
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading level="h2">Contact points</Heading>
        <Text className="text-ui-fg-muted">
          Each entry becomes a `ContactPoint` inside the Organization
          JSON-LD graph. Multiple entries let you split support /
          press / grievance channels — answer engines lift these
          individually when users ask "how to contact the brand".
        </Text>
        {contactPoints.map((cp, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border border-ui-border-base p-3"
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label>Contact type</Label>
                <Input
                  placeholder="customer support"
                  value={cp.contact_type}
                  onChange={(e) =>
                    updateContact(i, { contact_type: e.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Area served</Label>
                <Input
                  placeholder="IN"
                  value={cp.area_served ?? ""}
                  onChange={(e) =>
                    updateContact(i, { area_served: e.target.value || null })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Telephone (E.164)</Label>
                <Input
                  placeholder="+91-90087-70738"
                  value={cp.telephone ?? ""}
                  onChange={(e) =>
                    updateContact(i, { telephone: e.target.value || null })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Email</Label>
                <Input
                  placeholder="support@example.com"
                  value={cp.email ?? ""}
                  onChange={(e) =>
                    updateContact(i, { email: e.target.value || null })
                  }
                />
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <Label>Languages (comma-separated, ISO 639-1)</Label>
                <Input
                  placeholder="en, hi"
                  value={(cp.available_language ?? []).join(", ")}
                  onChange={(e) =>
                    updateContact(i, {
                      available_language: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
            </div>
            <div className="flex flex-col gap-2 rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
              <Label>Hours of availability (optional)</Label>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <Label>Opens</Label>
                  <Input
                    placeholder="10:00"
                    value={cp.hours?.opens ?? ""}
                    onChange={(e) => {
                      const opens = e.target.value
                      const h =
                        cp.hours ?? { days: [], opens: "", closes: "" }
                      updateContact(i, { hours: { ...h, opens } })
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Closes</Label>
                  <Input
                    placeholder="19:00"
                    value={cp.hours?.closes ?? ""}
                    onChange={(e) => {
                      const closes = e.target.value
                      const h =
                        cp.hours ?? { days: [], opens: "", closes: "" }
                      updateContact(i, { hours: { ...h, closes } })
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1 md:col-span-3">
                  <Label>Days</Label>
                  <div className="flex flex-wrap gap-2">
                    {DAY_NAMES.map((day) => {
                      const active = cp.hours?.days?.includes(day) ?? false
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => toggleContactDay(i, day)}
                          className={`rounded-md border px-3 py-1 text-xs ${
                            active
                              ? "border-ui-border-interactive bg-ui-bg-base-pressed"
                              : "border-ui-border-base"
                          }`}
                        >
                          {day.slice(0, 3)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
              {cp.hours && (
                <div className="flex justify-end">
                  <Button
                    variant="transparent"
                    size="small"
                    onClick={() => updateContact(i, { hours: null })}
                  >
                    Clear hours
                  </Button>
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <Button
                variant="transparent"
                size="small"
                onClick={() => removeContact(i)}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button variant="secondary" onClick={addContact}>
            + Add contact point
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading level="h2">Default meta</Heading>
        <Text className="text-ui-fg-muted">
          Used by {"<title>"}, OpenGraph, Twitter, and any page that
          doesn't explicitly override via{" "}
          <code className="font-mono text-xs">pageMeta.ts</code> or{" "}
          <code className="font-mono text-xs">generateMetadata</code>.
        </Text>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="title_default">Default title</Label>
            <Input
              id="title_default"
              value={meta.title_default}
              onChange={(e) => setMeta({ title_default: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="title_template">Title template</Label>
            <Input
              id="title_template"
              placeholder="%s | Brand"
              value={meta.title_template}
              onChange={(e) => setMeta({ title_template: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="locale">Locale</Label>
            <Input
              id="locale"
              value={meta.locale}
              onChange={(e) => setMeta({ locale: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="description_fallback">Description fallback</Label>
            <Textarea
              id="description_fallback"
              rows={3}
              value={meta.description_fallback}
              onChange={(e) => setMeta({ description_fallback: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="og_image">Default OG image URL</Label>
            <Input
              id="og_image"
              value={meta.og_image_url ?? ""}
              onChange={(e) =>
                setMeta({ og_image_url: e.target.value || null })
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="twitter_handle">Twitter handle</Label>
            <Input
              id="twitter_handle"
              value={meta.twitter_handle ?? ""}
              onChange={(e) =>
                setMeta({ twitter_handle: e.target.value || null })
              }
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="keywords">Keywords (comma-separated)</Label>
            <Input
              id="keywords"
              value={meta.keywords.join(", ")}
              onChange={(e) =>
                setMeta({
                  keywords: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={save} isLoading={saving}>
          Save general settings
        </Button>
      </div>
    </div>
  )
}

export default GeneralTab
