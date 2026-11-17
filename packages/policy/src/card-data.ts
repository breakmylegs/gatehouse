/**
 * E-093 (expansion, Wave E1): card data. A number that could be a real payment card (13 to 19 digits, written together
 * or in groups of four, starting as a card issuer's numbers do, passing the Luhn check, and not a documented test card)
 * is refused in a commit (the commit scan's floor) and held when an edit writes it into a file. Code that logs a card
 * field (pan, cardNumber, cvv and the like), or stores a CVV, is held too. A finding names the rule, the file and the
 * line, never the number; redaction takes card numbers out before anything is kept or sent.
 */
import fs from "node:fs"

export const CARD_DATA_RULE = "card-data"
export const CARD_DATA_RISK = 80

export interface CardFinding {
  ruleId: typeof CARD_DATA_RULE
  reason: string
  risk: number
}

/** Digits written together, or in groups of four (Amex 4-6-5), with no digit or letter either side. */
export const CARD_CANDIDATE = /(?<![\w-])(?:\d{13,19}|\d{4}([ -])\d{4}(?:\1\d{4}){1,2}(?:\1\d{1,3})?|\d{4}([ -])\d{6}\2\d{5})(?![\w-])/g

/** Documented test cards (Stripe, Adyen, Braintree, the card schemes' own), which pass. */
const TEST_CARDS = new Set([
  "4242424242424242", "4000056655665556", "4111111111111111", "4012888888881881", "4222222222222", "4000000000000002",
  "4000000000009995", "4000000000000077", "4000000000000069", "4000000000000127", "4000002500003155", "4000000000003220",
  "5555555555554444", "5200828282828210", "5105105105105100", "2223003122003222", "2222400010000008", "5454545454545454",
  "378282246310005", "371449635398431", "378734493671000", "6011111111111117", "6011000990139424", "6011000000000012",
  "3056930009020004", "36227206271667", "38520000023237", "30569309025904", "3566002020360505", "3530111333300000",
  "6200000000000005", "6205500000000000004", "6759649826438453", "4917610000000000", "4988438843884305",
])

/** Whether these digits start as a card issuer's do (Visa, Mastercard, Amex, Discover, Diners, JCB, UnionPay). */
function issuer(d: string): boolean {
  const n2 = Number(d.slice(0, 2))
  const n4 = Number(d.slice(0, 4))
  const len = d.length
  if (d.startsWith("4")) return len === 13 || len === 16 || len === 19
  if ((n2 >= 51 && n2 <= 55) || (n4 >= 2221 && n4 <= 2720)) return len === 16
  if (n2 === 34 || n2 === 37) return len === 15
  if (n2 === 36 || n2 === 38 || (n4 >= 3000 && n4 <= 3059)) return len === 14 || len === 16
  if (d.startsWith("6011") || n2 === 65 || (n4 >= 6440 && n4 <= 6499)) return len >= 16
  if (n4 >= 3528 && n4 <= 3589) return len >= 16
  if (n2 === 62) return len >= 16
  return false
}

function luhn(d: string): boolean {
  let sum = 0
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i])
    if (i % 2 === 1) n = n * 2 > 9 ? n * 2 - 9 : n * 2
    sum += n
  }
  return sum % 10 === 0
}

/** Whether a candidate's digits could be a card number (test cards included). */
export function looksLikeCard(candidate: string): boolean {
  const d = candidate.replace(/[ -]/g, "")
  return d.length >= 13 && d.length <= 19 && !/^(\d)\1+$/.test(d) && issuer(d) && luhn(d)
}

/** Whether a candidate could be a real card: a card number that is not a documented test card. */
export function isRealCard(candidate: string): boolean {
  const d = candidate.replace(/[ -]/g, "")
  return looksLikeCard(d) && !TEST_CARDS.has(d) && !d.startsWith("400000")
}

/** Whether a line of text holds a number that could be a real card. */
export function hasRealCard(text: string): boolean {
  for (const m of text.matchAll(CARD_CANDIDATE)) if (isRealCard(m[0])) return true
  return false
}

const LOGGING = /\b(?:console\.(?:log|info|warn|error|debug|trace)|(?:_?logger|log|Log|LOG)\.\w+|print(?:ln|f)?|System\.(?:out|err)\.print\w*|Console\.Write(?:Line)?|Debug\.Write(?:Line)?|Trace\.Write(?:Line)?|logging\.\w+|fmt\.Print\w*)\s*\(/
const CARD_FIELD = /\b(?:pan|PAN|primaryAccountNumber|card_?[Nn]umber|CardNumber|card_?[Nn]o|cc_?[Nn]umber|ccNum|cvv2?|CVV2?|Cvv2?|cvc2?|CVC2?|Cvc2?|security_?[Cc]ode|SecurityCode)\b/
const CVV = /\b(?:cvv2?|CVV2?|Cvv2?|cvc2?|CVC2?|Cvc2?|security_?[Cc]ode|SecurityCode)\b/
const STORING = /\b(?:localStorage|sessionStorage|setItem|writeFile\w*|appendFile\w*|INSERT\s+INTO|\.save\w*|\.insert\w*|\.create|\.put|\.set)\b/i

/** What each added line does with card data: a real-looking number, a card field logged, or a CVV stored. */
function lineFindings(text: string): Array<{ line: number; what: string }> {
  const out: Array<{ line: number; what: string }> = []
  text.split(/\r?\n/).forEach((l, i) => {
    if (hasRealCard(l)) out.push({ line: i + 1, what: "a number that could be a real card" })
    else if (LOGGING.test(l) && CARD_FIELD.test(l)) out.push({ line: i + 1, what: "a card field logged" })
    else if (STORING.test(l) && CVV.test(l)) out.push({ line: i + 1, what: "a card security code stored" })
  })
  return out
}

const current = (abs: string | undefined): string => {
  if (!abs) return ""
  try {
    return fs.readFileSync(abs, "utf8")
  } catch {
    return ""
  }
}

/** What an edit adds that is card data; undefined when it adds none. Names the file and line, never the value. */
export function cardDataFindings(tool: string, input: Record<string, unknown>, absPath: string | undefined): CardFinding | undefined {
  const file = typeof input.file_path === "string" ? input.file_path : ""
  if (!file) return undefined
  let before = ""
  let after = ""
  if (tool === "Write") {
    after = typeof input.content === "string" ? input.content : ""
    before = current(absPath)
  } else if (tool === "Edit") {
    before = typeof input.old_string === "string" ? input.old_string : ""
    after = typeof input.new_string === "string" ? input.new_string : ""
  } else if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    const edits = input.edits as Array<{ old_string?: unknown; new_string?: unknown }>
    before = edits.map((e) => (typeof e.old_string === "string" ? e.old_string : "")).join("\n")
    after = edits.map((e) => (typeof e.new_string === "string" ? e.new_string : "")).join("\n")
  } else return undefined
  // A line the file (or the replaced text) already had is not found again.
  const had = new Set(before.split(/\r?\n/).map((l) => l.trim()))
  const lines = after.split(/\r?\n/)
  const added = lineFindings(after).filter((f) => !had.has((lines[f.line - 1] ?? "").trim()))
  if (!added.length) return undefined
  const name = file.replace(/\\/g, "/").split("/").pop() ?? file
  // An Edit's line is within its new text; a Write's is the file's own.
  const where = (n: number) => (tool === "Write" ? `${name}, line ${n}` : name)
  const kinds = [...new Set(added.map((f) => `${f.what} (${where(f.line)})`))].slice(0, 5)
  return {
    ruleId: CARD_DATA_RULE,
    reason: `This edit adds card data: ${kinds.join("; ")}. Use a documented test card number, and never log or keep card numbers or security codes. It waits for you.`,
    risk: CARD_DATA_RISK,
  }
}
