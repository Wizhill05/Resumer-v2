"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Activity, ExternalLink, Layers, Timer } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AnalyticsData, PostHogOverview, PostHogOverviewData, ProductOverview } from "../api-types"
import { Funnel, LineChart, RankedBars, Sparkline, StackedBars } from "../charts"
import {
  Delta,
  Note,
  Panel,
  PanelHeader,
  Pill,
  RefreshButton,
  SectionTitle,
  Segmented,
  Skeleton,
  Stat,
  fetchJson,
  formatNumber,
} from "../shared"

const RANGES = [
  { value: 7, label: "7d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
]

function PostHogSetup({ error, projectUrl }: { error: string | null; projectUrl: string | null }) {
  if (error) {
    return (
      <Panel>
        <PanelHeader title="PostHog could not be read" icon={<Activity size={15} className="text-red-500" />} />
        <Note tone="error">{error}</Note>
        {projectUrl && (
          <a href={projectUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-xs font-bold text-[#ff4e26] underline underline-offset-4">
            Open PostHog <ExternalLink size={12} />
          </a>
        )}
      </Panel>
    )
  }
  return (
    <Panel>
      <PanelHeader title="Connect PostHog to see audience metrics" icon={<Activity size={15} className="text-[#ff4e26]" />} />
      <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-300">
        Events are already flowing into PostHog, but reading them back needs a personal API key. Set these on the backend and reload:
      </p>
      <dl className="mt-3 space-y-2 font-mono text-[11px]">
        <div className="border border-zinc-200 p-2 dark:border-zinc-700">
          <dt className="font-bold text-black dark:text-white">POSTHOG_PERSONAL_API_KEY</dt>
          <dd className="mt-0.5 font-sans text-zinc-500">Personal API key with the Query: read scope.</dd>
        </div>
        <div className="border border-zinc-200 p-2 dark:border-zinc-700">
          <dt className="font-bold text-black dark:text-white">POSTHOG_PROJECT_ID</dt>
          <dd className="mt-0.5 font-sans text-zinc-500">The number in your PostHog project URL.</dd>
        </div>
      </dl>
    </Panel>
  )
}

function AudienceKpis({ data, totalUsers }: { data: PostHogOverviewData; totalUsers?: number }) {
  const { kpis, dau, wau, mau, pageviews } = data.activity
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label="Active today"
        value={formatNumber(kpis.dau)}
        accent
        sub={<><Delta current={kpis.dau} previous={kpis.dau_prev} suffix="vs yesterday" /></>}
        spark={<Sparkline values={dau.slice(-14)} color="var(--viz-1)" label="Daily active users, last 14 days" />}
      />
      <Stat
        label="Active this week"
        value={formatNumber(kpis.wau)}
        sub={<Delta current={kpis.wau} previous={kpis.wau_prev} suffix="vs last week" />}
        spark={<Sparkline values={wau.slice(-14)} color="var(--viz-2)" label="Weekly active users, last 14 days" />}
      />
      <Stat
        label="Active this month"
        value={formatNumber(kpis.mau)}
        sub={<Delta current={kpis.mau} previous={kpis.mau_prev} suffix="vs last week" />}
        spark={<Sparkline values={mau.slice(-14)} color="var(--viz-3)" label="Monthly active users, last 14 days" />}
      />
      <Stat
        label="Total users"
        value={totalUsers === undefined ? "…" : formatNumber(totalUsers)}
        sub="Registered accounts"
      />
      <Stat label="Active now" value={formatNumber(kpis.active_now)} sub="Visitors in the last 30 min" />
      <Stat label="Stickiness" value={`${kpis.stickiness}%`} sub="Daily actives ÷ monthly actives" />
      <Stat
        label="Pageviews today"
        value={formatNumber(kpis.pageviews_today)}
        sub={<Delta current={kpis.pageviews_today} previous={kpis.pageviews_prev} suffix="vs yesterday" />}
        spark={<Sparkline values={pageviews.slice(-14)} color="var(--viz-1)" label="Pageviews, last 14 days" />}
      />
      <Stat
        label="Sessions today"
        value={formatNumber(kpis.sessions_today)}
        sub={<Delta current={kpis.sessions_today} previous={kpis.sessions_prev} suffix="vs yesterday" />}
      />
    </div>
  )
}

function ProductKpis({ product }: { product: ProductOverview }) {
  const k = product.kpis
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Total users" value={formatNumber(k.total_users)} accent sub={`${k.pro_users} on Pro`} />
      <Stat
        label="New this week"
        value={formatNumber(k.new_users_7d)}
        sub={<><Delta current={k.new_users_7d} previous={k.new_users_prev_7d} suffix="vs prior week" /></>}
        spark={<Sparkline values={product.signups.slice(-14)} color="var(--viz-1)" label="Signups, last 14 days" />}
      />
      <Stat label="Signups today" value={formatNumber(k.new_users_today)} sub="UTC day" />
      <Stat
        label="Resumes this week"
        value={formatNumber(k.generations_7d)}
        sub={<Delta current={k.generations_7d} previous={k.generations_prev_7d} suffix="vs prior week" />}
        spark={<Sparkline values={product.generations.total.slice(-14)} color="var(--viz-2)" label="Resumes, last 14 days" />}
      />
    </div>
  )
}

function BreakdownGrid({ data }: { data: PostHogOverviewData }) {
  const toItems = (key: keyof PostHogOverviewData["breakdowns"]) =>
    data.breakdowns[key].map((item) => ({ label: item.label, value: item.views, sub: `${formatNumber(item.visitors)} ppl` }))
  const groups: { key: keyof PostHogOverviewData["breakdowns"]; title: string }[] = [
    { key: "pages", title: "Top pages" },
    { key: "referrers", title: "Traffic sources" },
    { key: "countries", title: "Countries" },
    { key: "devices", title: "Devices" },
    { key: "browsers", title: "Browsers" },
  ]
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map((group) => (
        <Panel key={group.key}>
          <PanelHeader title={group.title} hint="Pageviews, with unique people" />
          <RankedBars items={toItems(group.key)} color="var(--viz-1)" />
        </Panel>
      ))}
    </div>
  )
}

function PipelineHealth({ analytics, loading, error }: { analytics?: AnalyticsData; loading: boolean; error: boolean }) {
  if (loading) return <Skeleton className="h-40" />
  if (error || !analytics) return <Note tone="error">Pipeline health could not be loaded.</Note>
  const buckets = analytics.duration_buckets
  const bucketRows = buckets
    ? [
        { label: "Under 30s", value: buckets.under_30s },
        { label: "30–60s", value: buckets["30s_to_60s"] },
        { label: "1–2 min", value: buckets["1m_to_2m"] },
        { label: "2–5 min", value: buckets["2m_to_5m"] },
        { label: "Over 5 min", value: buckets.over_5m },
      ]
    : []
  const status = analytics.generations_by_status
  const statusRows = Object.entries(status).map(([label, value]) => ({
    label: label.replace("_", " "),
    value,
    sub: analytics.total_generations ? `${Math.round((value / analytics.total_generations) * 100)}%` : undefined,
  }))
  const llm = analytics.llm_status
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total builds" value={formatNumber(analytics.total_generations)} sub={`${formatNumber(analytics.total_guest_generations)} by guests`} />
        <Stat
          label="Failure rate"
          value={`${analytics.failure_rate_percent}%`}
          sub="Failed ÷ all builds"
        />
        <Stat label="Median build" value={`${analytics.p50_latency_seconds ?? "--"}s`} sub={`p90 ${analytics.p90_latency_seconds ?? "--"}s · p99 ${analytics.p99_latency_seconds ?? "--"}s`} />
        <Stat label="Tokens used" value={formatNumber(analytics.llm_metrics.total_tokens)} sub={`${formatNumber(analytics.llm_metrics.recorded_calls)} model calls`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel>
          <PanelHeader title="Builds by status" icon={<Layers size={15} className="text-[#ff4e26]" />} />
          <RankedBars items={statusRows} color="var(--viz-3)" />
        </Panel>
        <Panel>
          <PanelHeader title="Build time distribution" icon={<Timer size={15} className="text-[#ff4e26]" />} hint="Completed builds only" />
          <RankedBars items={bucketRows} color="var(--viz-2)" />
        </Panel>
      </div>
      <Panel>
        <PanelHeader
          title="LLM routing"
          aside={
            llm ? (
              <Pill tone={llm.ready ? "good" : "bad"}>{llm.ready ? "Ready" : "Not configured"}</Pill>
            ) : (
              <Pill>Unavailable</Pill>
            )
          }
        />
        <dl className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["Resume generation", llm?.default_primary],
              ["Pro", llm?.pro_primary],
            ] as const
          ).map(([label, primary]) => (
            <div key={label} className="min-w-0 border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/60">
              <dt className="text-[10px] font-bold uppercase text-zinc-500">{label}</dt>
              <dd className="mt-1 min-w-0">
                {primary ? (
                  <>
                    <p className="truncate text-sm font-black text-black dark:text-white">{primary.endpoint_name}</p>
                    <p className="truncate font-mono text-[11px] text-[#ff4e26]">{primary.model}</p>
                  </>
                ) : (
                  <p className="text-sm font-bold text-zinc-400">Not routed</p>
                )}
              </dd>
            </div>
          ))}
        </dl>
        {llm && (
          <p className="mt-3 font-mono text-[11px] text-zinc-500">
            {llm.endpoints_enabled}/{llm.endpoints_total} endpoints enabled
          </p>
        )}
      </Panel>
    </div>
  )
}

export function OverviewTab({ onOpenTab }: { onOpenTab?: (tab: "models") => void }) {
  const queryClient = useQueryClient()
  const [days, setDays] = useState(30)

  const product = useQuery<ProductOverview>({
    queryKey: ["admin", "overview", "product", days],
    queryFn: () => fetchJson<ProductOverview>(`/api/backend/admin/overview/product?days=${days}`),
  })
  const posthog = useQuery<PostHogOverview>({
    queryKey: ["admin", "overview", "posthog", days],
    queryFn: () => fetchJson<PostHogOverview>(`/api/backend/admin/overview/posthog?days=${days}`),
    staleTime: 60_000,
  })
  const analytics = useQuery<AnalyticsData>({
    queryKey: ["admin", "analytics"],
    queryFn: () => fetchJson<AnalyticsData>("/api/backend/admin/analytics"),
  })

  const ph = posthog.data?.data ?? null
  const busy = product.isFetching || posthog.isFetching || analytics.isFetching
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] })
  const windowLabel = `Last ${days} days · UTC`

  return (
    <div className="space-y-6 pixel-enter">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Date range" value={days} options={RANGES} onChange={setDays} />
          <span className="text-[11px] text-zinc-500">{windowLabel}</span>
        </div>
        <RefreshButton onClick={refresh} busy={busy} />
      </div>

      {/* Audience */}
      <div className="space-y-3">
        <SectionTitle
          aside={
            posthog.data?.project_url ? (
              <a href={posthog.data.project_url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-[11px] font-bold text-zinc-500 hover:text-[#ff4e26]">
                PostHog <ExternalLink size={11} />
              </a>
            ) : undefined
          }
        >
          Audience
        </SectionTitle>
        {posthog.isLoading ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : posthog.isError ? (
          <Note tone="error">The overview request failed. Use Refresh to try again.</Note>
        ) : !ph ? (
          <>
            <PostHogSetup error={posthog.data?.error ?? null} projectUrl={posthog.data?.project_url ?? null} />
            {product.data && <ProductKpis product={product.data} />}
          </>
        ) : (
          <>
            {(ph.partial || ph.truncated) && (
              <Note tone="warn">
                {ph.partial ? "Some PostHog queries failed, so a few panels may be empty. " : ""}
                {ph.truncated ? "The visitor sample hit its row limit, so weekly and monthly counts are a floor." : ""}
              </Note>
            )}
            <AudienceKpis data={ph} totalUsers={product.data?.kpis.total_users} />
            <Panel>
              <PanelHeader title="Active users" hint="Daily, rolling 7-day and rolling 30-day unique visitors" aside={<span className="text-[11px] text-zinc-500">{windowLabel}</span>} />
              <LineChart
                dates={ph.activity.dates}
                caption="Daily, weekly and monthly active users"
                series={[
                  { key: "dau", label: "Daily", values: ph.activity.dau, color: "var(--viz-1)" },
                  { key: "wau", label: "Weekly", values: ph.activity.wau, color: "var(--viz-2)" },
                  { key: "mau", label: "Monthly", values: ph.activity.mau, color: "var(--viz-3)" },
                ]}
              />
            </Panel>
            <Panel>
              <PanelHeader title="Traffic" hint="Pageviews and sessions per day" />
              <LineChart
                dates={ph.activity.dates}
                caption="Pageviews and sessions per day"
                area
                series={[
                  { key: "pageviews", label: "Pageviews", values: ph.activity.pageviews, color: "var(--viz-1)" },
                  { key: "sessions", label: "Sessions", values: ph.activity.sessions, color: "var(--viz-2)" },
                ]}
              />
            </Panel>
          </>
        )}
      </div>

      {/* Product growth, straight from the database */}
      <div className="space-y-3">
        <SectionTitle>Growth</SectionTitle>
        {product.isLoading ? (
          <Skeleton className="h-64" />
        ) : product.isError || !product.data ? (
          <Note tone="error">Growth data could not be loaded.</Note>
        ) : (
          <>
            {ph && <ProductKpis product={product.data} />}
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel>
                <PanelHeader title="Total users" hint="Registered accounts over time" />
                <LineChart
                  dates={product.data.dates}
                  caption="Total registered users"
                  area
                  series={[{ key: "total", label: "Users", values: product.data.users_total, color: "var(--viz-1)" }]}
                />
              </Panel>
              <Panel>
                <PanelHeader title="New signups" hint="Accounts created per day" />
                <StackedBars
                  dates={product.data.dates}
                  caption="New signups per day"
                  series={[{ key: "signups", label: "Signups", values: product.data.signups, color: "var(--viz-1)" }]}
                />
              </Panel>
              <Panel>
                <PanelHeader title="Resumes generated" hint="Builds per day by outcome" />
                <StackedBars
                  dates={product.data.dates}
                  caption="Resume builds per day by outcome"
                  series={[
                    { key: "completed", label: "Completed", values: product.data.generations.completed, color: "var(--viz-3)" },
                    { key: "failed", label: "Failed", values: product.data.generations.failed, color: "var(--viz-2)" },
                    { key: "other", label: "Pending or running", values: product.data.generations.other, color: "var(--viz-1)" },
                  ]}
                />
              </Panel>
              <Panel>
                <PanelHeader title="People building" hint="Signed-in users who started a resume, per day" />
                <LineChart
                  dates={product.data.dates}
                  caption="Distinct signed-in users who built a resume per day"
                  series={[{ key: "builders", label: "Builders", values: product.data.builders, color: "var(--viz-2)" }]}
                />
              </Panel>
            </div>
          </>
        )}
      </div>

      {/* Funnel + breakdowns */}
      {ph && (
        <div className="space-y-3">
          <SectionTitle>Behaviour</SectionTitle>
          <Panel>
            <PanelHeader title="Conversion funnel" hint="Distinct PostHog IDs per step, so a visitor who signs in can count twice" />
            <Funnel steps={ph.funnel} />
          </Panel>
          <BreakdownGrid data={ph} />
        </div>
      )}

      {/* Pipeline health */}
      <div className="space-y-3">
        <SectionTitle
          aside={
            onOpenTab && (
              <button
                type="button"
                onClick={() => onOpenTab("models")}
                className={cn("inline-flex min-h-11 cursor-pointer items-center text-[11px] font-bold text-zinc-500 hover:text-[#ff4e26]")}
              >
                Manage endpoints →
              </button>
            )
          }
        >
          Pipeline health
        </SectionTitle>
        <PipelineHealth analytics={analytics.data} loading={analytics.isLoading} error={analytics.isError} />
      </div>
    </div>
  )
}
