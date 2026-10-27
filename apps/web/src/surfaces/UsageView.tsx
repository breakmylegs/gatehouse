import { useEffect, useState } from "react"
import { api } from "../lib/api"
import { money } from "../lib/format"
import { useStore, type UsageTotals } from "../store"

interface Digest {
  text: string
  askedYou: number
  costUsd: number
}

const tokens = (n: number | undefined) => (n ?? 0).toLocaleString("en-GB")

function Table({
  title,
  rows,
  label,
}: {
  title: string
  rows: Array<[string, UsageTotals]>
  label: string
}) {
  if (rows.length === 0) return null
  return (
    <section aria-label={title} className="grid gap-1">
      <h3 className="m-0 text-[14px] font-semibold">{title}</h3>
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="border-b border-line text-[13px] text-mut">
            <th className="py-1 pr-3 font-semibold">{label}</th>
            <th className="py-1 pr-3 text-right font-semibold">Spend</th>
            <th className="py-1 pr-3 text-right font-semibold">Input tokens</th>
            <th className="py-1 text-right font-semibold">Output tokens</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, t]) => (
            <tr key={k} className="border-b border-line">
              <td className="py-1 pr-3 [overflow-wrap:anywhere]">{k}</td>
              <td className="py-1 pr-3 text-right">{money(t.costUsd)}</td>
              <td className="py-1 pr-3 text-right">{tokens(t.inputTokens)}</td>
              <td className="py-1 text-right">{tokens(t.outputTokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

export function UsageView() {
  const usage = useStore((s) => s.usage)
  const [digest, setDigest] = useState<Digest>()
  useEffect(() => {
    void api<Digest>("GET", "/api/digest").then((r) => r.ok && r.data && setDigest(r.data))
  }, [])

  const byCost = (o: Record<string, UsageTotals> | undefined) =>
    Object.entries(o ?? {}).sort((a, b) => b[1].costUsd - a[1].costUsd)
  const days = Object.entries(usage?.byDay ?? {})
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 14)
  return (
    <div className="grid gap-4">
      {digest ? (
        <section aria-label="Last 24 hours" className="panel grid gap-1 p-4">
          <h2 className="m-0 text-[17px] font-semibold">Last 24 hours</h2>
          <p className="m-0">{digest.text}</p>
        </section>
      ) : null}
      <section aria-label="Usage" className="grid gap-4">
        <h2 className="m-0 text-[17px] font-semibold">Usage</h2>
        {usage?.total ? (
          <p className="m-0 text-mut">
            All time: <strong className="text-tx">{money(usage.total.costUsd)}</strong>,{" "}
            {tokens(usage.total.inputTokens)} input and {tokens(usage.total.outputTokens)} output
            tokens.
          </p>
        ) : (
          <p className="m-0 text-mut">No usage recorded yet.</p>
        )}
        <Table title="Last 14 days" label="Day" rows={days} />
        <Table title="By project" label="Project" rows={byCost(usage?.byProject)} />
        <Table title="By model" label="Model" rows={byCost(usage?.byModel)} />
      </section>
    </div>
  )
}
