/**
 * E-016 (expansion, Wave E1): a database client pointed at a host that is not this computer goes to a person, with the
 * host shown; one that looks like production is Severe. Read from the command's own words: psql, sqlcmd, mysql, mongosh
 * (and mongo) and redis-cli, their host flags, connection strings and the environment variables they read. A client
 * with no host given talks to this computer and is left alone. Passwords in connection strings are never shown: the
 * host is said without them, and the redactor takes them out of everything recorded (redact.ts).
 */
import type { Segment } from "./segments.js"

export const REMOTE_DB_RULE = "remote-database"
export const REMOTE_DB_RISK = 75
export const PRODUCTION_DB_RISK = 90

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|::1|\[::1\]|\.|\(local\)|\(localdb\).*|host\.docker\.internal)$/i

/** E-016, E-021: a name that looks like production (a separate prod, production, prd or live in it). */
export const looksProduction = (name: string): boolean => /(^|[^a-z0-9])(prod|production|prd|live)([^a-z0-9]|$)/i.test(name)

export interface RemoteDbFinding {
  ruleId: typeof REMOTE_DB_RULE
  reason: string
  risk: number
}

const flag = (args: string[], ...names: string[]): string | undefined => {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    for (const n of names) {
      if (a === n && i + 1 < args.length) return args[i + 1]
      if (n.startsWith("--") && a.startsWith(`${n}=`)) return a.slice(n.length + 1)
      // mysql -hdb.example.com
      if (n.length === 2 && a.startsWith(n) && a.length > 2 && !a.startsWith("--")) return a.slice(2)
    }
  }
  return undefined
}

/** The host of a connection URI (postgres://user:pass@host:5432/db), without the credentials. */
export function uriHost(s: string): string | undefined {
  const m = /^(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?|sqlserver):\/\/(?:[^@/]*@)?([^/:?,]+)/i.exec(s)
  return m?.[2]
}

/** The host a libpq connection string names: "host=db.example.com dbname=app". */
const conninfoHost = (s: string) => /(?:^|\s)host=([^\s]+)/i.exec(s)?.[1]

/** sqlcmd -S tcp:db.example.com,1433 or db\SQLEXPRESS: the host part. */
const sqlServerHost = (s: string) => s.replace(/^(tcp|np|lpc):/i, "").split(/[,\\]/)[0]!.trim()

/** The variables set before the command: PGHOST=db psql. */
function assignments(seg: Segment): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of seg.text.slice(0, Math.max(0, seg.text.length - seg.coreText.length)).matchAll(/(\w+)=(\S+)/g))
    out[m[1]!.toUpperCase()] = m[2]!
  return out
}

/** The host a database client segment talks to; undefined when it is not one, "" when no host is named. */
export function databaseHost(seg: Segment): string | undefined {
  const name = seg.name.toLowerCase().replace(/\.exe$/, "")
  const args = seg.args
  const env = assignments(seg)
  const fromUri = () => args.map((a) => uriHost(a)).find(Boolean)
  switch (name) {
    case "psql":
    case "pg_dump":
    case "pg_restore":
      return flag(args, "-h", "--host") ?? fromUri() ?? args.map((a) => conninfoHost(a)).find(Boolean) ?? env.PGHOST ?? ""
    case "mysql":
    case "mysqldump":
      return flag(args, "-h", "--host") ?? fromUri() ?? env.MYSQL_HOST ?? ""
    case "sqlcmd": {
      const s = flag(args, "-S") ?? env.SQLCMDSERVER
      return s ? sqlServerHost(s) : ""
    }
    case "mongosh":
    case "mongo":
    case "mongodump":
    case "mongoexport":
      return fromUri() ?? flag(args, "--host") ?? ""
    case "redis-cli": {
      const u = flag(args, "-u")
      return (u ? uriHost(u) : undefined) ?? flag(args, "-h") ?? ""
    }
    default:
      return undefined
  }
}

/** A client talking to a database that is not on this computer, with the host; undefined when there is none. */
export function remoteDatabase(segments: Segment[]): RemoteDbFinding | undefined {
  for (const s of segments) {
    const host = databaseHost(s)
    if (!host || LOOPBACK.test(host)) continue
    const prod = looksProduction(host)
    return {
      ruleId: REMOTE_DB_RULE,
      reason: prod
        ? `This connects ${s.name} to ${host}, which looks like a production database, so it is Severe and waits for you.`
        : `This connects ${s.name} to the database on ${host}, not one on this computer, so it waits for you.`,
      risk: prod ? PRODUCTION_DB_RISK : REMOTE_DB_RISK,
    }
  }
  return undefined
}
