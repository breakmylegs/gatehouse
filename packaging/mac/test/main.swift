// Built with ../NavGuard.swift by apps/host/test/navguard-mac.test.ts, so the Mac window's rules are tested as compiled.
// --decide <uri> <origin> <where>: prints allow, external or refuse, then the report line when not allow.
import Foundation

let a = CommandLine.arguments
if a.count == 5 && a[1] == "--decide" {
  let action = NavGuard.decide(a[2], origin: a[3], where: a[4])
  print(action.rawValue)
  if action != .allow { print(NavGuard.report(where: a[4], uri: a[2], action: action)) }
  exit(0)
}
FileHandle.standardError.write("usage: --decide <uri> <origin> <window|frame|new-window>\n".data(using: .utf8)!)
exit(2)
