// Built with ../../NotchPlace.swift by apps/host/test/notch-place-mac.test.ts.
//   <notchRight> <screenTop> <screenMinX> <screenMaxX> <wingWidth> [x,y,width,layer,mine ...]   prints the wing's x
import CoreGraphics
import Foundation

let a: [String] = Array(CommandLine.arguments.dropFirst())
let n = a.prefix(5).compactMap { Double($0) }.map { CGFloat($0) }
let windows = Array(a.dropFirst(5)).compactMap { (spec: String) -> TopWindow? in
  let p = spec.split(separator: ",").map(String.init)
  guard p.count == 5, let x = Double(p[0]), let y = Double(p[1]), let w = Double(p[2]), let l = Int(p[3]) else { return nil }
  return TopWindow(x: CGFloat(x), y: CGFloat(y), width: CGFloat(w), layer: l, mine: p[4] == "1")
}
print(Int(NotchPlace.wingX(
  notchRight: n[0], screenTop: n[1], screenMinX: n[2], screenMaxX: n[3], wingWidth: n[4], windows: windows)))
