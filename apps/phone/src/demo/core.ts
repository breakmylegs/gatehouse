import type { PendingItem, Session } from "../core"

export const isStandalone = () => new URLSearchParams(location.search).get("browser") === null
export const isIos = () => true
export const unlock = async (): Promise<Session> => ({
  token: "t",
  expiresAt: Date.now() + 3_600_000,
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const verdict = (risk: number, text: string) => ({
  outcome: "escalate",
  ruleId: "destructive-shell-with-a-long-rule-identifier",
  reason:
    "This reason is deliberately long so it has to wrap over several lines on a narrow phone screen and still read clearly.",
  risk,
  segments: [{ text, ruleId: "x", outcome: "escalate" }],
})
const base = (
  i: number,
  kind: string,
  tool: string,
  input: unknown,
  risk: number,
  flag?: string,
) => ({
  relayId: `r${i}`,
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  opened: {
    payloadHash: "h",
    ...(flag === "oversize" ? { oversize: { characters: 48213 } } : {}),
    payload: {
      id: `r${i}`,
      nonce: "n",
      kind,
      toolName: tool,
      input,
      cwd: "C:\Users\peter.j.kelly\OneDrive - Accenture\Documents\Very Long Folder Name Very Long Folder Name\proj",
      project: [
        "atlas-migration",
        "Überprüfung-日本語-проект",
        "x",
        "a-very-long-project-name-that-keeps-on-going-and-going-and-going",
      ][i % 4],
      verdict: verdict(risk, "git push --force origin main"),
      createdAt: "",
      expiresAt: "",
    },
  },
})
const items = [
  base(
    0,
    "permission",
    "Bash",
    { command: "git push --force origin main && npm publish --access public" },
    82,
  ),
  base(
    1,
    "permission",
    "Bash",
    {
      command: Array.from({ length: 60 }, (_, i) => `echo "line ${i} ${"x".repeat(40)}"`).join(
        " && ",
      ),
    },
    95,
  ),
  base(2, "permission", "Bash", { shown: "nothing" }, 70, "oversize"),
  base(
    3,
    "question",
    "AskUserQuestion",
    {
      questions: [
        {
          question: "Which environment should I deploy to, and should I tag the release first?",
          options: [
            { label: "Staging", description: "Safe to try" },
            { label: "Production", description: "Needs a tag first" },
          ],
        },
      ],
    },
    0,
  ),
  ...Array.from({ length: 12 }, (_, i) =>
    base(
      i + 4,
      "permission",
      "Bash",
      { command: `npm install package-${i}` },
      [10, 45, 70][i % 3]!,
    ),
  ),
  {
    ...base(99, "permission", "Bash", { command: "ls" }, 5),
    resolved: { at: "x", summary: "Approved on desktop at 14:02" },
  },
]
export const loadPending = async (): Promise<PendingItem[]> => items as unknown as PendingItem[]
export const answer = async (_s: Session, _d: unknown, item: PendingItem, what: unknown) => {
  await sleep(600)
  if (new URLSearchParams(location.search).get("fail"))
    throw new Error("Face ID was cancelled or did not match. Nothing was sent.")
  console.log("answer", item.relayId, JSON.stringify(what))
}
export const kill = async () => void (await sleep(600))
export const enableNotifications = async () => void (await sleep(300))
export const register = async () => ({
  pairingId: "p",
  fingerprint: "481516",
  code: "ABCD2345",
  keys: {} as never,
  info: {} as never,
})
export const awaitConfirmation = () => new Promise<never>(() => undefined)
export const call = async () => undefined
export class RelayError extends Error {}
