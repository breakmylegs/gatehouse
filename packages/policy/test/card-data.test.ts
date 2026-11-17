// E-093: a number that could be a real card is found (Luhn, an issuer's start, not a documented test card), an edit
// that writes one, logs a card field or stores a CVV waits naming only file and line, and redaction takes numbers out.
// The real-looking numbers are made at run time, so this file holds none and can itself be committed.
import { describe, expect, it } from "vitest"
import { CARD_DATA_RULE, cardDataFindings, hasRealCard, isRealCard, looksLikeCard } from "../src/card-data.js"
import { redact, redactString } from "../src/redact.js"

/** The digits with a Luhn check digit added. */
function withCheck(body: string): string {
  for (let c = 0; c <= 9; c++) {
    const d = `${body}${c}`
    let sum = 0
    for (let i = 0; i < d.length; i++) {
      let n = Number(d[d.length - 1 - i])
      if (i % 2 === 1) n = n * 2 > 9 ? n * 2 - 9 : n * 2
      sum += n
    }
    if (sum % 10 === 0) return d
  }
  throw new Error("unreachable")
}

const VISA = withCheck(["4532", "0151", "1283", "036"].join(""))
const AMEX = withCheck("37144963539843")
const grouped = (d: string) => d.match(/.{1,4}/g)?.join(" ") ?? d

describe("card data (E-093)", () => {
  it("finds a number that could be a real card, together or in groups, and passes test cards and other numbers", () => {
    expect(isRealCard(VISA)).toBe(true)
    expect(isRealCard(grouped(VISA))).toBe(true)
    expect(looksLikeCard(AMEX)).toBe(true)
    expect(hasRealCard(`const pan = "${VISA}"`)).toBe(true)
    for (const test of ["4242424242424242", "4111 1111 1111 1111", "5555555555554444", "378282246310005", "4000000000000077"])
      expect(isRealCard(test), test).toBe(false)
    // Not Luhn-valid, no issuer starts this way, a millisecond time, part of a longer word or hash.
    expect(hasRealCard(`${VISA.slice(0, -1)}${(Number(VISA.slice(-1)) + 1) % 10}`)).toBe(false)
    expect(hasRealCard(withCheck("999912345678901"))).toBe(false)
    expect(hasRealCard("at 1731830400000")).toBe(false)
    expect(hasRealCard(`sha a${VISA}b`)).toBe(false)
  })

  it("holds an edit that writes one, logs a card field or stores a CVV, naming file and line and never the number", () => {
    const r = cardDataFindings("Write", { file_path: "C:/w/test/fixtures/orders.json", content: `{\n  "card": "${VISA}"\n}\n` }, undefined)
    expect(r).toMatchObject({ ruleId: CARD_DATA_RULE })
    expect(r?.reason).toContain("orders.json, line 2")
    expect(r?.reason).not.toContain(VISA)
    expect(cardDataFindings("Edit", { file_path: "src/pay.ts", old_string: "", new_string: "logger.info(`paid ${order.cardNumber}`)" }, undefined)?.reason).toContain("a card field logged")
    expect(cardDataFindings("Write", { file_path: "src/pay.py", content: "print(f'cvv {cvv}')\n" }, undefined)?.reason).toContain("a card field logged")
    expect(cardDataFindings("Write", { file_path: "src/pay.ts", content: "localStorage.setItem('c', form.cvv)\n" }, undefined)?.reason).toContain("a card security code stored")
    expect(cardDataFindings("MultiEdit", { file_path: "src/pay.cs", edits: [{ old_string: "x", new_string: "_logger.LogInformation(\"{Pan}\", pan);" }] }, undefined)).toMatchObject({ ruleId: CARD_DATA_RULE })
  })

  it("leaves test cards, card fields used without logging, and lines the file already had", () => {
    expect(cardDataFindings("Write", { file_path: "test/pay.test.ts", content: 'charge("4242 4242 4242 4242")\n' }, undefined)).toBeUndefined()
    expect(cardDataFindings("Write", { file_path: "src/pay.ts", content: "const masked = mask(cardNumber)\nconsole.log('paid')\n" }, undefined)).toBeUndefined()
    expect(cardDataFindings("Edit", { file_path: "src/pay.ts", old_string: "console.log(pan)", new_string: "console.log(pan)\nreturn" }, undefined)).toBeUndefined()
    expect(cardDataFindings("Read", { file_path: "src/pay.ts" }, undefined)).toBeUndefined()
  })

  it("redaction takes card numbers out of what is kept or sent, and leaves other long numbers", () => {
    const kept = JSON.stringify(redact({ command: `echo ${VISA} >> log.txt`, content: `card ${grouped(VISA)}` }))
    expect(kept).not.toContain(VISA)
    expect(kept).not.toContain(grouped(VISA))
    expect(kept).toContain("[REDACTED:card-number]")
    expect(redactString("order 1731830400000")).toBe("order 1731830400000")
  })
})
