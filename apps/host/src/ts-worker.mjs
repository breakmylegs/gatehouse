// C-032: the TypeScript language service, in a worker thread of its own so a large project cannot slow or crash the
// Host; a memory cap ends it and the Host starts another (apps/host/src/ts-service.ts). Plain JavaScript, so it loads
// the same under tsx (the packaged Host), Vitest and plain Node. One language service per project folder, kept while
// the worker lives. It reads files from disk (the project's own sources and its type files), never writes.
import fs from "node:fs"
import path from "node:path"
import { parentPort } from "node:worker_threads"
import ts from "typescript"

const services = new Map()

/** The project's compiler options: its nearest tsconfig.json, else sensible defaults for a loose folder. */
function settingsFor(root) {
  const configPath = ts.findConfigFile(root, (f) => fs.existsSync(f), "tsconfig.json")
  if (configPath && path.dirname(configPath).startsWith(root)) {
    const read = ts.readConfigFile(configPath, (f) => fs.readFileSync(f, "utf8"))
    const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, path.dirname(configPath))
    return { options: { ...parsed.options, noEmit: true }, files: parsed.fileNames }
  }
  return { options: { allowJs: true, checkJs: false, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: true }, files: [] }
}

function serviceFor(root) {
  let s = services.get(root)
  if (s) return s
  const { options, files } = settingsFor(root)
  const open = new Set(files)
  const host = {
    getScriptFileNames: () => [...open],
    getScriptVersion: (f) => {
      try {
        return String(fs.statSync(f).mtimeMs)
      } catch {
        return "0"
      }
    },
    getScriptSnapshot: (f) => {
      try {
        return ts.ScriptSnapshot.fromString(fs.readFileSync(f, "utf8"))
      } catch {
        return undefined
      }
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  }
  s = { ls: ts.createLanguageService(host, ts.createDocumentRegistry()), open }
  services.set(root, s)
  return s
}

const flat = (t) => ts.flattenDiagnosticMessageText(t, "\n")

/** A position in a file as line and column (both from 1), and its text around it. */
function where(file, start, length) {
  const text = fs.readFileSync(file, "utf8")
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest)
  const a = sf.getLineAndCharacterOfPosition(start)
  const lineText = text.split(/\r?\n/)[a.line] ?? ""
  return { file, line: a.line + 1, column: a.character + 1, length, text: lineText.trim().slice(0, 200) }
}

function run({ op, root, file, pos }) {
  const { ls, open } = serviceFor(root)
  open.add(file)
  if (op === "diagnostics") {
    const all = [...ls.getSyntacticDiagnostics(file), ...ls.getSemanticDiagnostics(file)]
    return all.slice(0, 200).map((d) => ({
      ...(d.file && d.start !== undefined ? where(d.file.fileName, d.start, d.length ?? 0) : { file, line: 1, column: 1, length: 0, text: "" }),
      message: flat(d.messageText).slice(0, 1000),
      severity: d.category === ts.DiagnosticCategory.Error ? "error" : d.category === ts.DiagnosticCategory.Warning ? "warning" : "info",
      code: d.code,
    }))
  }
  if (op === "info") {
    const q = ls.getQuickInfoAtPosition(file, pos)
    if (!q) return null
    return { text: ts.displayPartsToString(q.displayParts).slice(0, 2000), docs: ts.displayPartsToString(q.documentation ?? []).slice(0, 2000) }
  }
  if (op === "definition") return (ls.getDefinitionAtPosition(file, pos) ?? []).slice(0, 50).map((d) => where(d.fileName, d.textSpan.start, d.textSpan.length))
  if (op === "references") return (ls.getReferencesAtPosition(file, pos) ?? []).slice(0, 500).map((r) => where(r.fileName, r.textSpan.start, r.textSpan.length))
  throw new Error(`unknown op ${op}`)
}

parentPort?.on("message", (m) => {
  try {
    parentPort.postMessage({ id: m.id, ok: true, result: run(m) })
  } catch (e) {
    parentPort.postMessage({ id: m.id, ok: false, error: String(e && e.message ? e.message : e).slice(0, 500) })
  }
})
