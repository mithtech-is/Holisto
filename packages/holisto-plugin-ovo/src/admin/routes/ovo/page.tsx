import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Sparkles } from "@medusajs/icons"
import React, { useEffect, useState } from "react"
import { Container, Heading, Tabs, Text } from "@medusajs/ui"

import GeneralTab from "./_components/GeneralTab"
import SeoTab from "./_components/SeoTab"
import GeoSgeTab from "./_components/GeoSgeTab"
import AeoTab from "./_components/AeoTab"
import LlmoTab from "./_components/LlmoTab"
import EntityKgTab from "./_components/EntityKgTab"
import RetrievalTab from "./_components/RetrievalTab"
import PagesTab from "./_components/PagesTab"
import SubmitTab from "./_components/SubmitTab"
import MetricsTab from "./_components/MetricsTab"
import AuditTab from "./_components/AuditTab"
import KeywordsTab from "./_components/KeywordsTab"
import GroupsPerfTab from "./_components/GroupsPerfTab"
import OpportunitiesTab from "./_components/OpportunitiesTab"
import CannibalizationTab from "./_components/CannibalizationTab"
import IndexabilityTab from "./_components/IndexabilityTab"
import AiCitationsTab from "./_components/AiCitationsTab"

/**
 * /app/ovo — Online Visibility Optimization control surface.
 *
 * Single top-level admin page hosting one tab per visibility channel.
 * Tabs are independent — each one fetches and saves its own slice of
 * the `ovo_setting` row. URL hash mirrors the active tab so refreshes
 * stay on the same view (matches the Communication page convention).
 *
 * Path note: lives at `/app/ovo` rather than under `/app/extensions/`.
 * Medusa's dashboard auto-injects an "Extensions" sidebar group for
 * any route under `/extensions/*`, so to render as a single top-level
 * "OVO" entry we keep the URL at the root.
 */
type TabKey =
  | "general"
  | "seo"
  | "geo-sge"
  | "aeo"
  | "llmo"
  | "entity-kg"
  | "retrieval"
  | "pages"
  | "submit"
  | "metrics"
  | "audit"
  | "keywords"
  | "groups-perf"
  | "opportunities"
  | "cannibalization"
  | "indexability"
  | "ai-citations"

const VALID_TABS: TabKey[] = [
  "general",
  "seo",
  "geo-sge",
  "aeo",
  "llmo",
  "entity-kg",
  "retrieval",
  "pages",
  "submit",
  "metrics",
  "audit",
  "keywords",
  "groups-perf",
  "opportunities",
  "cannibalization",
  "indexability",
  "ai-citations",
]

function readInitialTab(): TabKey {
  if (typeof window === "undefined") return "general"
  const params = new URLSearchParams(window.location.search)
  const candidate = params.get("tab") as TabKey | null
  if (candidate && VALID_TABS.includes(candidate)) return candidate
  return "general"
}

const OnlineVisibilityOptimizationPage = () => {
  const [tab, setTab] = useState<TabKey>(readInitialTab)

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    if (params.get("tab") !== tab) {
      params.set("tab", tab)
      const next = window.location.pathname + "?" + params.toString()
      window.history.replaceState(null, "", next)
    }
  }, [tab])

  return (
    <Container className="flex flex-col gap-6 p-6">
      <div>
        <Heading level="h1">Online Visibility Optimization</Heading>
        <Text className="text-ui-fg-muted">
          One control surface for every channel a brand can be visible
          in — search engines, AI answer engines, generative-search
          experiences, knowledge graphs, RAG retrievers, and LLM
          training data. Changes save instantly and bust the storefront
          ISR cache so the public surface reflects edits within a few
          seconds.
        </Text>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        {/* 17 tabs — overflow-x-auto turns this into a scroll-strip
            on viewports narrower than the full row (matches the
            GitHub/Linear pattern). The negative margin lets the
            scroll-shadow visually align with the rest of the page
            gutter. */}
        <div className="-mx-1 overflow-x-auto">
          <Tabs.List className="flex-nowrap whitespace-nowrap">
          <Tabs.Trigger value="general">General</Tabs.Trigger>
          <Tabs.Trigger value="seo">SEO</Tabs.Trigger>
          <Tabs.Trigger value="geo-sge">GEO / SGE</Tabs.Trigger>
          <Tabs.Trigger value="aeo">AEO</Tabs.Trigger>
          <Tabs.Trigger value="llmo">LLMO</Tabs.Trigger>
          <Tabs.Trigger value="entity-kg">Entity & KG</Tabs.Trigger>
          <Tabs.Trigger value="retrieval">Retrieval</Tabs.Trigger>
          <Tabs.Trigger value="pages">Pages</Tabs.Trigger>
          <Tabs.Trigger value="submit">Submit</Tabs.Trigger>
          <Tabs.Trigger value="metrics">Metrics</Tabs.Trigger>
          <Tabs.Trigger value="audit">Audit</Tabs.Trigger>
          <Tabs.Trigger value="keywords">Keywords</Tabs.Trigger>
          <Tabs.Trigger value="groups-perf">Groups perf</Tabs.Trigger>
          <Tabs.Trigger value="opportunities">Opportunities</Tabs.Trigger>
          <Tabs.Trigger value="cannibalization">Cannibalisation</Tabs.Trigger>
          <Tabs.Trigger value="indexability">Indexability</Tabs.Trigger>
          <Tabs.Trigger value="ai-citations">AI citations</Tabs.Trigger>
          </Tabs.List>
        </div>
        <div className="mt-5">
          <Tabs.Content value="general">
            <GeneralTab />
          </Tabs.Content>
          <Tabs.Content value="seo">
            <SeoTab />
          </Tabs.Content>
          <Tabs.Content value="geo-sge">
            <GeoSgeTab />
          </Tabs.Content>
          <Tabs.Content value="aeo">
            <AeoTab />
          </Tabs.Content>
          <Tabs.Content value="llmo">
            <LlmoTab />
          </Tabs.Content>
          <Tabs.Content value="entity-kg">
            <EntityKgTab />
          </Tabs.Content>
          <Tabs.Content value="retrieval">
            <RetrievalTab />
          </Tabs.Content>
          <Tabs.Content value="pages">
            <PagesTab />
          </Tabs.Content>
          <Tabs.Content value="submit">
            <SubmitTab />
          </Tabs.Content>
          <Tabs.Content value="metrics">
            <MetricsTab />
          </Tabs.Content>
          <Tabs.Content value="audit">
            <AuditTab />
          </Tabs.Content>
          <Tabs.Content value="keywords">
            <KeywordsTab />
          </Tabs.Content>
          <Tabs.Content value="groups-perf">
            <GroupsPerfTab />
          </Tabs.Content>
          <Tabs.Content value="opportunities">
            <OpportunitiesTab />
          </Tabs.Content>
          <Tabs.Content value="cannibalization">
            <CannibalizationTab />
          </Tabs.Content>
          <Tabs.Content value="indexability">
            <IndexabilityTab />
          </Tabs.Content>
          <Tabs.Content value="ai-citations">
            <AiCitationsTab />
          </Tabs.Content>
        </div>
      </Tabs>
    </Container>
  )
}

// Registers the page as a top-level admin route. Medusa's dashboard
// groups custom routes that export a `label` under the "Extensions"
// section of the sidebar, so this renders as "Extensions → OVO" with
// the Sparkles icon. `rank` orders it among sibling extension entries.
export const config = defineRouteConfig({
  label: "OVO",
  icon: Sparkles,
  rank: 50,
})

export default OnlineVisibilityOptimizationPage
