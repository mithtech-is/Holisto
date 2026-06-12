import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  Badge,
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
  type OvoSettingView,
  type RobotsConfig,
  type SitemapShards,
} from "./types"

/**
 * Per-shard URL counts pulled from the live sitemap index. Optional —
 * if the sitemap is unreachable (storefront down, dev env, etc.) the
 * UI just renders "—" badges instead of erroring out.
 */
type ShardCountRow = {
  shard: string
  url: string
  count: number
  ok: boolean
  error?: string
}

async function loadShardCounts(): Promise<{
  shards: ShardCountRow[]
  total: number
  errors: string[]
}> {
  const r = await fetch("/admin/ovo/sitemap/shard-counts", {
    credentials: "include",
  })
  if (!r.ok) throw new Error(`Shard counts failed (${r.status})`)
  return (await r.json()) as {
    shards: ShardCountRow[]
    total: number
    errors: string[]
  }
}

/**
 * SEO tab — robots disallow paths, sitemap shard toggles.
 *
 * Bot allow/deny rules are NOT here — they live in the LLMO tab,
 * because the per-bot policy is shared across LLMO/AEO/GEO/SGEO
 * concerns and is conceptually about AI agents rather than search
 * engines.
 */
const SeoTab: React.FC = () => {
  const [draft, setDraft] = useState<OvoSettingView | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [shardCounts, setShardCounts] = useState<ShardCountRow[] | null>(null)
  const [shardCountsLoading, setShardCountsLoading] = useState(false)
  const [shardCountsErrors, setShardCountsErrors] = useState<string[]>([])

  useEffect(() => {
    loadOvo()
      .then(setDraft)
      .catch((err) => toast.error("Load failed", { description: (err as Error).message }))
      .finally(() => setLoading(false))
  }, [])

  const refreshShardCounts = useCallback(async () => {
    setShardCountsLoading(true)
    try {
      const r = await loadShardCounts()
      setShardCounts(r.shards)
      setShardCountsErrors(r.errors)
    } catch (err) {
      setShardCounts([])
      setShardCountsErrors([(err as Error).message])
    } finally {
      setShardCountsLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshShardCounts()
  }, [refreshShardCounts])

  // Quick map from "shard" key → count, used to render a small badge
  // next to each shard toggle. Missing key → "—" placeholder.
  //
  // IMPORTANT: this useMemo (and `robotsPreview` below) MUST live
  // above the `if (loading || !draft) return …` early-return so the
  // hook order stays stable across renders — see Rules of Hooks. On
  // first render `draft` is null and we'd otherwise call zero hooks
  // here; on the next render with `draft` set we'd call two, and
  // React would crash with "Rendered more hooks than during the
  // previous render."
  const countByShard = useMemo(() => {
    const m = new Map<string, ShardCountRow>()
    for (const s of shardCounts ?? []) m.set(s.shard, s)
    return m
  }, [shardCounts])

  // Build the robots.txt preview the storefront would emit for the
  // CURRENT draft (uncommitted edits included). Mirrors the actual
  // storefront generator structure (User-agent: * + Allow: / +
  // Disallow lines + Sitemap line) without round-tripping to the
  // storefront so operators can see the effect of pending edits.
  // Falls back to an empty string while `draft` is still loading;
  // the actual <pre> only renders once draft is set anyway.
  const robotsPreview = useMemo(() => {
    if (!draft) return ""
    const draftRobots = draft.robots ?? {
      disallow_paths: [],
      sitemap_url: null,
    }
    const lines: string[] = ["User-agent: *", "Allow: /"]
    for (const path of draftRobots.disallow_paths) {
      lines.push(`Disallow: ${path}`)
    }
    const sitemapUrl =
      draftRobots.sitemap_url || "https://your-domain.example/sitemap.xml"
    lines.push("", `Sitemap: ${sitemapUrl}`)
    return lines.join("\n")
  }, [draft])

  if (loading || !draft) return <Text>Loading…</Text>

  const robots: RobotsConfig =
    draft.robots ?? { disallow_paths: [], sitemap_url: null }
  const shards: SitemapShards =
    draft.sitemap_shards ?? {
      static: true,
      products: true,
      taxonomy: true,
      knowledge: true,
    }

  const setRobots = (patch: Partial<RobotsConfig>) =>
    setDraft({ ...draft, robots: { ...robots, ...patch } })
  const setShards = (patch: Partial<SitemapShards>) =>
    setDraft({ ...draft, sitemap_shards: { ...shards, ...patch } })

  const save = async () => {
    setSaving(true)
    try {
      const next = await saveOvo({
        robots,
        sitemap_shards: shards,
      })
      setDraft(next)
      toast.success("Saved", {
        description: "Robots + sitemap will reflect the change shortly.",
      })
    } catch (err) {
      toast.error("Save failed", { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Heading level="h2">Robots policy</Heading>
        <Text className="text-ui-fg-muted">
          Paths listed here are blocked from every crawler in /robots.txt.
          Authenticated surfaces (dashboard, cart, checkout) belong here.
        </Text>
        <div className="flex flex-col gap-1">
          <Label htmlFor="disallow_paths">
            Disallow paths (one per line — leading slash required)
          </Label>
          <Textarea
            id="disallow_paths"
            rows={8}
            value={robots.disallow_paths.join("\n")}
            onChange={(e) =>
              setRobots({
                disallow_paths: e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sitemap_url">
            Sitemap URL override (leave blank to auto-derive)
          </Label>
          <Input
            id="sitemap_url"
            placeholder="https://www.example.com/sitemap.xml"
            value={robots.sitemap_url ?? ""}
            onChange={(e) =>
              setRobots({ sitemap_url: e.target.value || null })
            }
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading level="h2">Robots preview</Heading>
        <Text className="text-ui-fg-muted">
          The /robots.txt the storefront would currently serve. Reflects
          your unsaved edits live — save when it looks right. Bot-specific
          rules (LLMs / AI crawlers) live in the LLMO tab and are merged
          in by the storefront.
        </Text>
        <pre className="max-h-64 overflow-auto rounded-md border border-ui-border-base bg-ui-bg-subtle p-3 text-xs font-mono">
          {robotsPreview}
        </pre>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <Heading level="h2">Sitemap shards</Heading>
            <Text className="text-ui-fg-muted">
              Each shard maps to /sitemap/&lt;name&gt;.xml. Disabling a
              shard empties its sitemap so Google de-indexes the URLs
              over time. Counts are pulled live from the storefront.
            </Text>
          </div>
          <Button
            variant="transparent"
            size="small"
            onClick={refreshShardCounts}
            disabled={shardCountsLoading}
          >
            {shardCountsLoading ? "Counting…" : "Refresh counts"}
          </Button>
        </div>
        {shardCountsErrors.length > 0 && (
          <div className="rounded-md border border-ui-tag-orange-border bg-ui-tag-orange-bg p-2 text-xs text-ui-tag-orange-text">
            Sitemap walk had {shardCountsErrors.length} issue
            {shardCountsErrors.length === 1 ? "" : "s"} —{" "}
            {shardCountsErrors.slice(0, 2).join(" · ")}
            {shardCountsErrors.length > 2
              ? ` · +${shardCountsErrors.length - 2} more`
              : ""}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(["static", "products", "taxonomy", "knowledge"] as const).map(
            (id) => {
              const c = countByShard.get(id)
              return (
                <div key={id} className="flex items-start gap-3">
                  <Switch
                    id={`shard_${id}`}
                    checked={shards[id]}
                    onCheckedChange={(checked) =>
                      setShards({ [id]: !!checked } as Partial<SitemapShards>)
                    }
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`shard_${id}`}>{id}</Label>
                      {c && c.ok ? (
                        <Badge
                          color={c.count > 0 ? "green" : "orange"}
                          size="2xsmall"
                        >
                          {c.count} URL{c.count === 1 ? "" : "s"}
                        </Badge>
                      ) : c ? (
                        <Badge color="red" size="2xsmall">
                          unreachable
                        </Badge>
                      ) : (
                        <Badge color="grey" size="2xsmall">—</Badge>
                      )}
                    </div>
                    <Text size="small" className="text-ui-fg-muted">
                      /sitemap/{id}.xml
                    </Text>
                  </div>
                </div>
              )
            },
          )}
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={save} isLoading={saving}>
          Save SEO settings
        </Button>
      </div>
    </div>
  )
}

export default SeoTab
