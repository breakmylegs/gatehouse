// @vitest-environment jsdom
// O52: CNW's sign-in page with single sign-on set: a button for each kind, each a plain link to its start (a
// top-level navigation, so the provider's page opens in this tab); the password and passkeys still offered beside it;
// and what a refused sign-in sent back said once, then taken off the address.
import fs from "node:fs"
import path from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))

beforeAll(async () => {
  const html = fs.readFileSync(path.join(here, "../public/index.html"), "utf8")
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/g, "")
  history.replaceState(null, "", "/?sso_error=No%20Neighbourhood%20Watch%20account%20matches%20you.")
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (url === "/api/me" ? json({ access: "none", setup: false, passkeys: true, sso: { oidc: "Authentik", saml: "Keycloak" } }) : json({}))),
  )
  const page = "../public/cnw.js"
  await import(/* @vite-ignore */ page)
  await vi.waitFor(() => expect(document.querySelector("main h2")?.textContent).toBe("Sign in with single sign-on"))
})

describe("signing in with single sign-on (O52)", () => {
  it("offers each kind as a link to its start, beside the password", () => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>("main a.btn")]
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Sign in with Authentik", "/api/sso/oidc/start"],
      ["Sign in with Keycloak", "/api/sso/saml/start"],
    ])
    expect(document.querySelector('input[name="password"]')).not.toBeNull()
  })

  it("says why a single sign-on was refused, once, and takes it off the address", () => {
    expect(document.querySelector("main [role=alert]")?.textContent).toBe("Single sign-on did not sign you in: No Neighbourhood Watch account matches you.")
    expect(location.search).toBe("")
  })
})
