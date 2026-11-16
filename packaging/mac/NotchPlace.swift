// Where the wing beside the notch goes, as a rule of its own, so apps/host/test/notch-place-mac.test.ts can run it.
// Foundation only. Another notch app (Vorssaint, 16 Nov) draws a black shape over the notch and a little either side,
// a level above the menu bar's icons: the wing just right of the notch was under it, out of sight. So the wing goes
// right of any such window that covers where it would be.
import CoreGraphics
import Foundation

/// A window at the top of the screen, as CGWindowList gives it: global, y from the top of the main screen.
struct TopWindow {
  let x: CGFloat
  let y: CGFloat
  let width: CGFloat
  let layer: Int
  let mine: Bool
}

enum NotchPlace {
  /// The menu bar's icons are at this level; a notch app draws above it.
  static let statusLevel = 25

  /// The wing's left edge: the notch's right edge, or past the right edge of another app's window over that spot
  /// above the menu bar's icons, and of any next to it; never so far right that the wing leaves the screen. A window
  /// wider than half the screen is not a notch app's (a full-width overlay), so it is not stepped round.
  static func wingX(
    notchRight: CGFloat, screenTop: CGFloat, screenMinX: CGFloat, screenMaxX: CGFloat, wingWidth: CGFloat,
    windows: [TopWindow]
  ) -> CGFloat {
    let others = windows.filter {
      !$0.mine && $0.layer > statusLevel && $0.y <= screenTop + 4 && $0.width < (screenMaxX - screenMinX) / 2
    }
    var x = notchRight
    var moved = true
    while moved {
      moved = false
      for w in others where w.x <= x + 1 && w.x + w.width > x {
        x = w.x + w.width + 4
        moved = true
      }
    }
    return min(x, screenMaxX - wingWidth)
  }
}
