// codehouse-limits: the Mac counterpart of packaging/Limits.cs. It runs Claude Code for one session with the session's
// limits on what it, and everything it starts, may use (owner, 30 Oct: Low, Medium and High per session). The Host
// calls it exactly as it calls Codehouse-Limits.exe (apps/host/src/limits.ts).
//
//   codehouse-limits --name <job> --cpu <percent> --memory-mb <MB> --priority <below|normal> [--report <s>] -- <command> [args...]
//       Runs the command with those limits, on this program's own input, output and error streams, and exits with its
//       exit code. When the command ends, or this program is stopped, whatever it started that is still running is
//       ended too. 0 for --cpu or --memory-mb means no limit. With --report, every so many seconds it writes what the
//       job uses to its error stream: [codeh-usage] {"cpu":<percent of the whole processor>,"memoryMb":<n>,"processes":<n>}
//   codehouse-limits --set <job> --cpu <percent> --memory-mb <MB> --priority <below|normal>
//       Changes the limits of a running job.
//
// A Mac has no job objects, so each limit is kept the Mac's way:
//   - The job is the command's process group (it is started as a group of its own) and every process descended from it.
//   - Priority below: nice 10, for every process in the job. macOS lets a program lower a priority but not raise it
//     again without an administrator, so a job set back to normal stays below until the session starts again.
//   - The processor: macOS cannot cap a group of processes, so the job is paused and resumed in slices of 100 ms
//     (SIGSTOP and SIGCONT, as cpulimit does), the share it may run adjusted to hold the cap.
//   - Memory: macOS does not enforce a memory limit on a process, so the job's memory footprint is read every slice
//     (every second without a processor cap),
//     and over the cap the largest process in the job is ended, with a line on the error stream saying so. On Windows
//     the job's allocation fails instead.
// Nothing here needs an administrator or any permission.
import Darwin
import Foundation

struct Limits: Codable, Equatable {
  var cpu: Int
  var memoryMb: Int
  var priority: String
}

func fail(_ message: String, code: Int32 = 2) -> Never {
  FileHandle.standardError.write("codehouse-limits: \(message)\n".data(using: .utf8)!)
  exit(code)
}

// MARK: the command line

var argv = Array(CommandLine.arguments.dropFirst())
var command: [String] = []
if let dash = argv.firstIndex(of: "--") {
  command = Array(argv[(dash + 1)...])
  argv = Array(argv[..<dash])
}
func option(_ name: String) -> String? {
  guard let i = argv.firstIndex(of: name), i + 1 < argv.count else { return nil }
  return argv[i + 1]
}
func number(_ name: String) -> Int {
  guard let t = option(name) else { return 0 }
  guard let n = Int(t), n >= 0 else { fail("\(name) must be a whole number, 0 or more") }
  return n
}
let limits = Limits(
  cpu: min(number("--cpu"), 100), memoryMb: number("--memory-mb"), priority: option("--priority") ?? "normal")
if limits.priority != "below" && limits.priority != "normal" { fail("--priority is below or normal") }

/// The folder where running jobs are found by name: this user's own temporary folder, which only they can open.
func jobDir() -> URL {
  var buf = [CChar](repeating: 0, count: Int(PATH_MAX))
  let n = confstr(_CS_DARWIN_USER_TEMP_DIR, &buf, buf.count)
  let base = n > 0 ? String(cString: buf) : NSTemporaryDirectory()
  let dir = URL(fileURLWithPath: base).appendingPathComponent("codehouse-limits")
  try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  return dir
}

/// A job name as a file name: the Host's names hold a backslash (Local\Codehouse-<id>).
func jobFile(_ job: String, _ ext: String) -> URL {
  let safe = String(job.map { $0.isLetter || $0.isNumber || "._-".contains($0) ? $0 : "_" }.prefix(120))
  return jobDir().appendingPathComponent("\(safe).\(ext)")
}

if let job = option("--set") {
  guard let pidText = try? String(contentsOf: jobFile(job, "pid"), encoding: .utf8),
    let pid = pid_t(pidText.trimmingCharacters(in: .whitespacesAndNewlines)), kill(pid, 0) == 0
  else { fail("there is no running job called \(job)", code: 1) }
  let data = try! JSONEncoder().encode(limits)
  do { try data.write(to: jobFile(job, "limits.json"), options: .atomic) } catch {
    fail("the limits could not be passed on: \(error.localizedDescription)", code: 1)
  }
  exit(0)
}

guard let job = option("--name"), !command.isEmpty else {
  fail(
    "usage: --name <job> --cpu <percent> --memory-mb <MB> --priority <below|normal> [--report <s>] -- <command> | --set <job> ..."
  )
}
let reportEvery = Double(number("--report"))

// MARK: the job's processes

let timebase: Double = {
  var t = mach_timebase_info_data_t()
  mach_timebase_info(&t)
  return Double(t.numer) / Double(t.denom)
}()
let processors = Double(ProcessInfo.processInfo.activeProcessorCount)

struct Proc {
  let pid: pid_t
  let cpuNs: Double
  let footprint: UInt64
}

/// The job's processes now: the command's process group, and every process descended from the command.
func jobProcesses(root: pid_t) -> [Proc] {
  let count = proc_listallpids(nil, 0)
  guard count > 0 else { return [] }
  var pids = [pid_t](repeating: 0, count: Int(count) + 64)
  let got = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<pid_t>.size))
  guard got > 0 else { return [] }
  var parent: [pid_t: pid_t] = [:]
  var group: [pid_t: pid_t] = [:]
  for pid in pids.prefix(Int(got)) where pid > 0 {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    if proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size {
      parent[pid] = pid_t(info.pbi_ppid)
      group[pid] = pid_t(info.pbi_pgid)
    }
  }
  func inJob(_ pid: pid_t) -> Bool {
    if group[pid] == root { return true }
    var p = pid
    for _ in 0..<64 {
      if p == root { return true }
      guard let up = parent[p], up > 1, up != p else { return false }
      p = up
    }
    return false
  }
  var out: [Proc] = []
  for pid in parent.keys where inJob(pid) {
    var r = rusage_info_v2()
    let ok = withUnsafeMutablePointer(to: &r) {
      $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V2, $0) }
    }
    if ok == 0 {
      out.append(
        Proc(
          pid: pid, cpuNs: Double(r.ri_user_time + r.ri_system_time) * timebase, footprint: r.ri_phys_footprint))
    }
  }
  return out
}

func signalAll(_ procs: [Proc], _ sig: Int32) {
  for p in procs { kill(p.pid, sig) }
}

// MARK: starting the command

// Stop and hang-up signals are handled in the loop below, so the job is resumed and ended before this program goes.
var pendingSignal: Int32 = 0
for s in [SIGTERM, SIGINT, SIGHUP] { signal(s, { pendingSignal = $0 }) }

// Below: this program lowers its own priority first, so the command has it from its first instruction.
if limits.priority == "below" { setpriority(PRIO_PROCESS, 0, 10) }
var attr: posix_spawnattr_t? = nil
posix_spawnattr_init(&attr)
posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETPGROUP))
posix_spawnattr_setpgroup(&attr, 0)
var cargs: [UnsafeMutablePointer<CChar>?] = command.map { strdup($0) } + [nil]
// The environment it was given, passed on as it is (the Host has already left out the credentials).
var cenv: [UnsafeMutablePointer<CChar>?] =
  ProcessInfo.processInfo.environment.map { strdup("\($0.key)=\($0.value)") } + [nil]
var child: pid_t = 0
let spawned = posix_spawnp(&child, command[0], nil, &attr, &cargs, &cenv)
posix_spawnattr_destroy(&attr)
if spawned != 0 { fail("\(command[0]) could not be started: \(String(cString: strerror(spawned)))", code: 127) }
try? "\(getpid())".write(to: jobFile(job, "pid"), atomically: true, encoding: .utf8)

func cleanUp() {
  try? FileManager.default.removeItem(at: jobFile(job, "pid"))
  try? FileManager.default.removeItem(at: jobFile(job, "limits.json"))
}

/// Ends whatever is still in the job: resumed first, so a paused process can take the signal.
func endJob() {
  var left = jobProcesses(root: child)
  signalAll(left, SIGCONT)
  signalAll(left, SIGTERM)
  let deadline = Date().addingTimeInterval(2)
  while !left.isEmpty && Date() < deadline {
    usleep(50_000)
    var status: Int32 = 0
    _ = waitpid(child, &status, WNOHANG)
    left = jobProcesses(root: child)
  }
  signalAll(left, SIGKILL)
}

func say(_ line: String) {
  FileHandle.standardError.write((line + "\n").data(using: .utf8)!)
}

// MARK: keeping the limits

var current = limits
var lastLimitsCheck = Date.distantPast
var limitsStamp: Date?
var reniced = Set<pid_t>()
var lastCpu: [pid_t: Double] = [:]
var runShare = 1.0
var reportCpuNs = 0.0
var reportSince = Date()
var lastMemoryKill = Date.distantPast
var lastScan = Date.distantPast
let period = 0.1

func readNewLimits() {
  guard Date().timeIntervalSince(lastLimitsCheck) >= 1 else { return }
  lastLimitsCheck = Date()
  let file = jobFile(job, "limits.json")
  guard let stamp = (try? FileManager.default.attributesOfItem(atPath: file.path))?[.modificationDate] as? Date,
    stamp != limitsStamp, let data = try? Data(contentsOf: file),
    let l = try? JSONDecoder().decode(Limits.self, from: data)
  else { return }
  limitsStamp = stamp
  if current.priority == "below" && l.priority == "normal" {
    say("[codeh-limits] the priority goes back to normal when the session next starts: macOS lets a program lower its priority but not raise it again")
  }
  current = Limits(cpu: min(l.cpu, 100), memoryMb: l.memoryMb, priority: current.priority == "below" ? "below" : l.priority)
  if current.cpu == 0 { runShare = 1 }
}

/// CPU used by the job since the last call, in nanoseconds, from each process's own total.
func cpuSince(_ procs: [Proc]) -> Double {
  var used = 0.0
  var now: [pid_t: Double] = [:]
  for p in procs {
    now[p.pid] = p.cpuNs
    used += max(0, p.cpuNs - (lastCpu[p.pid] ?? p.cpuNs))
  }
  lastCpu = now
  return used
}

var exitCode: Int32 = 0
loop: while true {
  var status: Int32 = 0
  let w = waitpid(child, &status, WNOHANG)
  if w == child {
    let sig = status & 0x7F
    exitCode = sig == 0 ? (status >> 8) & 0xFF : 128 + sig
    break loop
  }
  if pendingSignal != 0 || getppid() == 1 {
    exitCode = 128 + (pendingSignal != 0 ? pendingSignal : SIGHUP)
    break loop
  }
  readNewLimits()
  // Listing every process on the Mac costs about 2% of a core at ten a second; without a processor cap, once a second
  // keeps the memory cap, the priority and the report.
  let capped = current.cpu > 0
  if !capped && Date().timeIntervalSince(lastScan) < 1 {
    usleep(useconds_t(period * 1_000_000))
    continue
  }
  lastScan = Date()
  let procs = jobProcesses(root: child)

  if current.priority == "below" {
    for p in procs where !reniced.contains(p.pid) {
      if getpriority(PRIO_PROCESS, id_t(p.pid)) < 10 { setpriority(PRIO_PROCESS, id_t(p.pid), 10) }
      reniced.insert(p.pid)
    }
  }

  // Memory: over the cap, the largest process in the job is ended, at most once a second.
  if current.memoryMb > 0 {
    let total = procs.reduce(UInt64(0)) { $0 + $1.footprint }
    if total > UInt64(current.memoryMb) << 20, Date().timeIntervalSince(lastMemoryKill) >= 1,
      let big = procs.max(by: { $0.footprint < $1.footprint })
    {
      lastMemoryKill = Date()
      kill(big.pid, SIGCONT)
      kill(big.pid, SIGKILL)
      say(
        "[codeh-limits] ended process \(big.pid), which used \(big.footprint >> 20) MB: the session's memory limit is \(current.memoryMb) MB"
      )
    }
  }

  // The processor: run for runShare of the slice, pause for the rest, and move runShare towards the cap.
  if capped && runShare < 1 {
    usleep(useconds_t(period * runShare * 1_000_000))
    signalAll(procs, SIGSTOP)
    usleep(useconds_t(period * (1 - runShare) * 1_000_000))
    signalAll(procs, SIGCONT)
  } else if capped {
    usleep(useconds_t(period * 1_000_000))
  }
  let used = cpuSince(capped ? jobProcesses(root: child) : procs)
  reportCpuNs += used
  if capped {
    let share = used / (period * 1e9 * processors)
    let cap = Double(current.cpu) / 100
    if share > cap {
      runShare = max(0.02, runShare * (0.6 + 0.4 * cap / share))
    } else {
      runShare = min(1, runShare * 1.1 + 0.01)
    }
  }

  if reportEvery > 0, Date().timeIntervalSince(reportSince) >= reportEvery {
    let wall = Date().timeIntervalSince(reportSince)
    let cpu = min(100, reportCpuNs / (wall * 1e9 * processors) * 100)
    let memoryMb = procs.reduce(UInt64(0)) { $0 + $1.footprint } >> 20
    say("[codeh-usage] {\"cpu\":\((cpu * 10).rounded() / 10),\"memoryMb\":\(memoryMb),\"processes\":\(procs.count)}")
    reportCpuNs = 0
    reportSince = Date()
  }
}

endJob()
cleanUp()
exit(exitCode)
