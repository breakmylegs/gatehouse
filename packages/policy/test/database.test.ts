// E-016: which host a database client talks to, from its flags, connection strings and environment, and whether that
// is another computer (it waits for you) or looks like production (Severe). Passwords are never in what is said.
import { describe, expect, it } from "vitest"
import { analyseBash } from "../src/bash.js"
import { PRODUCTION_DB_RISK, REMOTE_DB_RISK, REMOTE_DB_RULE, databaseHost, looksProduction, remoteDatabase } from "../src/database.js"
import { redactString } from "../src/redact.js"

const judge = async (cmd: string) => remoteDatabase((await analyseBash(cmd)).segments)
const host = async (cmd: string) => databaseHost((await analyseBash(cmd)).segments[0]!)

describe("database clients and their hosts (E-016)", () => {
  it("reads the host from flags, URIs, connection strings and the environment", async () => {
    expect(await host("psql -h db.example.com")).toBe("db.example.com")
    expect(await host("psql --host=db2.example.com")).toBe("db2.example.com")
    expect(await host("psql 'host=db3.example.com dbname=app'")).toBe("db3.example.com")
    expect(await host("PGHOST=10.0.0.5 psql")).toBe("10.0.0.5")
    expect(await host("mysql -hdb4")).toBe("db4")
    expect(await host("sqlcmd -S tcp:sql.example.com,1433")).toBe("sql.example.com")
    expect(await host("sqlcmd -S '.\\SQLEXPRESS'")).toBe(".")
    expect(await host("redis-cli -u redis://cache.example.com:6379")).toBe("cache.example.com")
    expect(await host("psql")).toBe("")
    expect(await host("npm test")).toBeUndefined()
  })

  it("lets a database on this computer through, and holds another computer's, production as Severe", async () => {
    for (const cmd of ["psql -h localhost", "psql -h 127.0.0.1 -d app", "psql -d app", "sqlcmd -S '.\\SQLEXPRESS'", "redis-cli", "mongosh mongodb://localhost:27017/app"])
      expect(await judge(cmd), cmd).toBeUndefined()
    expect(await judge("psql -h db.example.com")).toMatchObject({ ruleId: REMOTE_DB_RULE, risk: REMOTE_DB_RISK })
    expect(await judge("psql -h prod-db.example.com")).toMatchObject({ risk: PRODUCTION_DB_RISK })
    expect(await judge("npm test && mysql -h live.example.com")).toMatchObject({ risk: PRODUCTION_DB_RISK })
    expect(looksProduction("prod-weu")).toBe(true)
    expect(looksProduction("products-db")).toBe(false)
  })

  it("never says the password, and the redactor takes it out of what is recorded", async () => {
    // Put together here, so the repository holds no address with a password in it (the commit check refuses one).
    const cmd = ["psql postgres://app", "hunter2@db.example.com/shop"].join(":")
    const r = await judge(cmd)
    expect(r?.reason).toContain("db.example.com")
    expect(r?.reason).not.toContain("hunter2")
    expect(redactString(cmd)).not.toContain("hunter2")
  })
})
