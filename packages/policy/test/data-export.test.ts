// E-017: a bulk export of data waits for you, with what it takes and where it goes; one to a place outside the project
// is higher risk. A command that only reads, or Export-Csv of something that is not a query's results, is left alone.
import { describe, expect, it } from "vitest"
import { analyseBash } from "../src/bash.js"
import { BULK_EXPORT_RULE, EXPORT_INSIDE_RISK, EXPORT_OUTSIDE_RISK, bulkExport } from "../src/data-export.js"

const CWD = "C:/dev/shop"
const judge = async (cmd: string) => bulkExport((await analyseBash(cmd)).segments, CWD, cmd)

describe("bulk data exports (E-017)", () => {
  it("holds a dump to Downloads as outside the project, naming the target", async () => {
    const r = await judge("pg_dump -d shop -f C:/Users/me/Downloads/shop.sql")
    expect(r).toMatchObject({ ruleId: BULK_EXPORT_RULE, risk: EXPORT_OUTSIDE_RISK })
    expect(r?.reason).toContain("C:/Users/me/Downloads/shop.sql")
    expect(await judge("mysqldump shop > /c/Users/me/Downloads/shop.sql")).toMatchObject({ risk: EXPORT_OUTSIDE_RISK })
    expect(await judge("mongoexport --db shop --collection orders --out D:/exports/orders.json")).toMatchObject({ risk: EXPORT_OUTSIDE_RISK })
    expect(await judge("bcp dbo.orders out C:/temp/orders.dat -S db -T")).toMatchObject({ risk: EXPORT_OUTSIDE_RISK })
    expect(await judge("psql -c \"COPY orders TO '/tmp/orders.csv' CSV\"")).toMatchObject({ risk: EXPORT_OUTSIDE_RISK })
    expect(await judge("mysql -e \"SELECT * FROM orders INTO OUTFILE '/tmp/o.csv'\"")).toMatchObject({ risk: EXPORT_OUTSIDE_RISK })
    expect(await judge("sqlcmd -S . -Q 'select * from orders' -o C:/temp/o.txt")).toMatchObject({ risk: EXPORT_OUTSIDE_RISK })
  })

  it("still holds one inside the project, at a lower risk, and one with no file", async () => {
    expect(await judge("pg_dump -d shop -f backups/shop.sql")).toMatchObject({ ruleId: BULK_EXPORT_RULE, risk: EXPORT_INSIDE_RISK })
    expect((await judge("pg_dump shop"))?.reason).toMatch(/to the screen or another program/)
  })

  it("leaves a query that only reads alone", async () => {
    for (const cmd of ["psql -c 'select 1'", "mysql -e 'show tables'", "sqlcmd -Q 'select 1'", "npm test"])
      expect(await judge(cmd), cmd).toBeUndefined()
  })
})
