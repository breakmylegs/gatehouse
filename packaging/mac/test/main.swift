// Built with ../NavGuard.swift, ../Shortcut.swift, ../Host.swift and ../MacEvents.swift by apps/host/test/navguard-mac.test.ts,
// shortcut-mac.test.ts, devtools-mac.test.ts and mac-events-mac.test.ts, so the Mac window's rules are tested as compiled.
//   --decide <uri> <origin> <where>       allow, external or refuse, then the report line when not allow
//   --parse <shortcut>                    {"ok":true,"text":...,"mods":...,"key":...} or {"ok":false,"error":...}
//   --alternatives <shortcut> [taken,...]  up to three free alternatives, one a line
//   --devtools <git>                      the developer folder Codehouse would use instead of Xcode's, or none
//   --env                                 the Host's environment, KEY=value a line
//   --host-line <line>                    what a line from the Host is: its notice, as JSON, for attention and settled
//   --folder <path>...                    the folder the Finder's paths open, or none
import Foundation

func json(_ o: [String: Any]) -> String {
  String(data: try! JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]), encoding: .utf8)!
}

let a = CommandLine.arguments
if a.count == 5 && a[1] == "--decide" {
  let action = NavGuard.decide(a[2], origin: a[3], where: a[4])
  print(action.rawValue)
  if action != .allow { print(NavGuard.report(where: a[4], uri: a[2], action: action)) }
  exit(0)
}
if a.count == 3 && a[1] == "--parse" {
  switch Shortcut.parse(a[2]) {
  case .success(let s): print(json(["ok": true, "text": s.text, "mods": s.mods, "key": s.key]))
  case .failure(let e): print(json(["ok": false, "error": e.message]))
  }
  exit(0)
}
if (a.count == 3 || a.count == 4) && a[1] == "--alternatives", case .success(let s) = Shortcut.parse(a[2]) {
  let taken = a.count == 4 ? a[3].split(separator: ",").map(String.init) : []
  for alt in s.alternatives(isFree: { !taken.contains($0.text) }) { print(alt) }
  exit(0)
}
if a.count == 3 && a[1] == "--devtools" {
  print(DeveloperTools.fallback(git: a[2]) ?? "none")
  exit(0)
}
if a.count == 2 && a[1] == "--env" {
  for (k, v) in HostProcess(version: "test", path: "/usr/bin:/bin").environment().sorted(by: { $0.key < $1.key }) {
    print("\(k)=\(v)")
  }
  exit(0)
}
if a.count == 3 && a[1] == "--host-line" {
  switch HostEvent.parse(a[2]) {
  case .attention(let n?):
    print(json([
      "event": "attention", "id": n.id, "identifier": n.identifier, "category": n.category ?? "none", "body": n.body,
      "deny": n.message(for: RequestNotice.denyAction) ?? "none", "allow": n.message(for: RequestNotice.allowAction) ?? "none",
    ]))
  case .attention(nil): print(json(["event": "attention"]))
  case .settled(let id): print(json(["event": "settled", "id": id]))
  default: print(json(["event": "other"]))
  }
  exit(0)
}
if a.count >= 2 && a[1] == "--folder" {
  print(FinderFolder.pick(Array(a.dropFirst(2)), isFolder: FinderFolder.isFolder) ?? "none")
  exit(0)
}
FileHandle.standardError.write("usage: --decide <uri> <origin> <where> | --parse <s> | --alternatives <s> [taken]\n".data(using: .utf8)!)
exit(2)
