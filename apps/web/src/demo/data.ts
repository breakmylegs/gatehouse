import type { Health, PendingView, SessionInfo } from "@gatehouse/shared/ws-protocol"

/** Worst-case data for the break-ui pass. Used only by demo.html, never by the real app. */
export type Case = "normal" | "worst" | "empty" | "offline" | "approver-down" | "killed"

const now = Date.now()
const iso = (ms: number) => new Date(now + ms).toISOString()

export const health = (c: Case): Health => ({
  approver: { state: c === "approver-down" ? "down" : "up", errors: [] },
  relay: { state: c === "offline" ? "unreachable" : "not-configured", devices: 0 },
  signin: {
    signedIn: true,
    email: "a.very.long.email.address.for.testing@example-client-name.co.uk",
    organization: "ACN - Premium",
    managedPolicy: "detected",
    orgOk: true,
  },
  killSwitch: { engaged: c === "killed", approverConfirmed: true },
  pwsh: { running: true },
})

const NAMES = [
  "atlas-migration",
  "proposal-q4",
  "Überprüfung-日本語-проект",
  "a".repeat(120),
  "gatehouse",
  "x",
  "client-with-a-ridiculously-long-project-name-that-keeps-going-and-going",
]
const states: SessionInfo["state"][] = ["running", "waiting", "idle", "error", "starting", "ended"]

export function sessions(n: number): SessionInfo[] {
  return Array.from({ length: n }, (_, i) => {
    const project = NAMES[i % NAMES.length] as string
    return {
      id: `s${i}`,
      cwd: `C:\dev\${"deeply\nested\\".repeat(i % 4)}${project}`,
      project,
      model: i % 3 === 0 ? undefined : "claude-sonnet-5-5",
      mode: i % 5 === 0 ? "plan" : "default",
      state: states[i % states.length] as SessionInfo["state"],
      pendingApprovals: i % 4,
      createdAt: iso(-i * 60_000),
      ...(i % states.length === 3
        ? {
            error:
              "The session stopped: the account check failed after a very long chain of reasons that wraps",
          }
        : {}),
    }
  })
}

const LONG = Array.from({ length: 300 }, (_, i) => `echo "line ${i}: ${"x".repeat(30)}"`).join(
  " && ",
)
const HUGE = 'node -e "' + "console.log('a'.repeat(100))".repeat(180) + '"'

export function pending(n: number, sessionCount: number): PendingView[] {
  return Array.from({ length: n }, (_, i) => {
    const command =
      i === 0
        ? HUGE
        : i === 1
          ? LONG
          : i === 2
            ? "rm -rf ./日本語/файл-имя-очень-длинное.txt && git push --force origin main"
            : `npm install package-${i}`
    const project = NAMES[i % NAMES.length] as string
    return {
      request: {
        id: `r${String(i).padStart(4, "0")}`,
        nonce: "n",
        kind: i % 17 === 5 ? "plan" : i % 13 === 7 ? "question" : "permission",
        sessionId: `s${i % Math.max(1, sessionCount)}`,
        toolUseId: `tu${i}`,
        toolName: i % 6 === 3 ? "Write" : "Bash",
        input: { command },
        cwd: `C:\Users\peter.j.kelly\OneDrive - Accenture\Documents\${"Very Long Folder Name ".repeat(6)}${project}`,
        project,
        verdict: {
          outcome: "escalate",
          ruleId: i % 2 ? "package-install" : "destructive-shell-with-a-long-rule-identifier",
          reason:
            "This reason is deliberately long so that it has to wrap across several lines in the narrow column and still read clearly to the person deciding.",
          risk: [10, 45, 70, 82, 95][i % 5] as number,
          segments: [{ text: command.slice(0, 40), ruleId: "x", outcome: "escalate" }],
          decidedBy: "rules",
          policyHash: "h",
        },
        createdAt: iso(-i * 1000),
        expiresAt: iso(600_000),
        payloadHash: "p",
      },
      rawInput:
        i % 13 === 7 && i % 17 !== 5
          ? {
              questions: [
                {
                  question:
                    "Which environment should I deploy to, and should I tag the release first?",
                  options: [
                    { label: "Staging", description: "Safe" },
                    { label: "Production", description: "Needs a tag" },
                  ],
                },
              ],
            }
          : i % 17 === 5
            ? { plan: "1. Read the code\n2. Change it\n3. Run the tests\n".repeat(30) }
            : i % 6 === 3
              ? {
                  file_path: "C:\dev\ünï\\" + "deep\\".repeat(30) + "file.txt",
                  content: "x".repeat(2000),
                }
              : { command },
      defaultToNo: ([10, 45, 70, 82, 95][i % 5] as number) >= 70,
      phone: (["none", "held", "delivered", "expired"] as const)[i % 4] as PendingView["phone"],
      hardDeadline: iso(1_800_000),
    }
  })
}
