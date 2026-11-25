// Codehouse.app's program. Double-click the app; these options are for the terminal:
//
//   Codehouse.app/Contents/MacOS/Codehouse --check   start, check the Host and the window, stop (exit code 0 or 1)
import AppKit

let args = Array(CommandLine.arguments.dropFirst())
if args.contains("--help") {
  print(
    """
    Codehouse \(Bundle.main.object(forInfoDictionaryKey: "CodehouseVersion") as? String ?? "")
      --check   start, confirm the Host answers with its token and refuses without it, load the interface in a
                window that is not shown, stop (exit code 0 or 1)
      --help    this list
    """)
  exit(0)
}
let check = args.contains("--check")
// A line to a Host that has just stopped (HostProcess.tell) fails rather than ending Codehouse.
signal(SIGPIPE, SIG_IGN)
let app = NSApplication.shared
// The delegate is held here: NSApplication keeps only a weak reference to it.
let delegate = AppDelegate(check: check)
app.delegate = delegate
app.setActivationPolicy(check ? .accessory : .regular)
app.run()
