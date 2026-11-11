// Built with ../NavGuard.swift and ../Shortcut.swift by apps/host/test/navguard-mac.test.ts and shortcut-mac.test.ts,
// so the Mac window's rules are tested as compiled.
//   --decide <uri> <origin> <where>       allow, external or refuse, then the report line when not allow
//   --parse <shortcut>                    {"ok":true,"text":...,"mods":...,"key":...} or {"ok":false,"error":...}
//   --alternatives <shortcut> [taken,...]  up to three free alternatives, one a line
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
FileHandle.standardError.write("usage: --decide <uri> <origin> <where> | --parse <s> | --alternatives <s> [taken]\n".data(using: .utf8)!)
exit(2)
