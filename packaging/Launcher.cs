// Gatehouse.exe: starts Gatehouse from the folder it sits in.
//
// Expected layout next to this file:
//   Gatehouse.exe
//   runtime\node.exe          the Node it runs on (a copy of Node 22 or newer)
//   app\                      the application, with its node_modules
//
// It starts the Host (which starts the Approver), prints the one-time address, and opens it in your browser.
// Closing the window or pressing Ctrl+C stops everything. If the launcher is killed, Windows ends the children too.
//
// Written in C# 5 so the compiler that ships with Windows can build it (no SDK needed).

using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;

internal static class Launcher
{
    // A job object that ends every child when this process ends, however it ends.
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr attrs, string name);
    [DllImport("kernel32.dll")]
    private static extern bool SetInformationJobObject(IntPtr job, int infoType, IntPtr info, uint size);
    [DllImport("kernel32.dll")]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimit
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong a, b, c, d, e, f;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimit
    {
        public BasicLimit Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    private static IntPtr job = IntPtr.Zero;
    private static Process host;
    private static Process relay;

    private static void Say(string text)
    {
        Console.WriteLine("[gatehouse] " + text);
    }

    private static void MakeJob()
    {
        job = CreateJobObject(IntPtr.Zero, null);
        ExtendedLimit info = new ExtendedLimit();
        info.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        int size = Marshal.SizeOf(typeof(ExtendedLimit));
        IntPtr p = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, p, false);
            SetInformationJobObject(job, 9, p, (uint)size); // JobObjectExtendedLimitInformation
        }
        finally
        {
            Marshal.FreeHGlobal(p);
        }
    }

    private static string FindNode(string root)
    {
        string bundled = Path.Combine(root, "runtime", "node.exe");
        if (File.Exists(bundled)) return bundled;
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string dir in path.Split(Path.PathSeparator))
        {
            try
            {
                string candidate = Path.Combine(dir.Trim().Trim('"'), "node.exe");
                if (File.Exists(candidate)) return candidate;
            }
            catch (ArgumentException) { }
        }
        return null;
    }

    private static Process Start(string node, string appDir, string entry, string extraArgs)
    {
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = node;
        psi.Arguments = "\"" + Path.Combine(appDir, "node_modules", "tsx", "dist", "cli.mjs") + "\" \"" + entry + "\"" +
                        (string.IsNullOrEmpty(extraArgs) ? "" : " " + extraArgs);
        psi.WorkingDirectory = appDir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardInput = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        // The one clean way to ask a child to stop that works the same everywhere: close its input.
        psi.EnvironmentVariables["GATEHOUSE_EXIT_ON_STDIN_CLOSE"] = "1";
        psi.EnvironmentVariables["GATEHOUSE_PACKAGED"] = "1";
        Process p = new Process();
        p.StartInfo = psi;
        p.Start();
        if (job != IntPtr.Zero) AssignProcessToJobObject(job, p.Handle);
        return p;
    }

    private static void StopAll()
    {
        foreach (Process p in new Process[] { relay, host })
        {
            if (p == null) continue;
            try { p.StandardInput.Close(); } catch (Exception) { }
        }
        foreach (Process p in new Process[] { relay, host })
        {
            if (p == null) continue;
            try
            {
                if (!p.HasExited && !p.WaitForExit(5000)) p.Kill();
            }
            catch (Exception) { }
        }
    }

    private static void OpenBrowser(string url)
    {
        string[] edges = new string[]
        {
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe")
        };
        foreach (string edge in edges)
        {
            if (File.Exists(edge))
            {
                Process.Start(edge, url);
                return;
            }
        }
        ProcessStartInfo psi = new ProcessStartInfo(url);
        psi.UseShellExecute = true;
        Process.Start(psi);
    }

    private static int Main(string[] args)
    {
        bool noBrowser = false, check = false, withRelay = false, help = false;
        string relayArgs = "";
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--no-browser") noBrowser = true;
            else if (a == "--check") check = true;
            else if (a == "--relay") withRelay = true;
            else if (a == "--help" || a == "-h" || a == "/?") help = true;
            else if (a == "--public-url" && i + 1 < args.Length) relayArgs = "--public-url \"" + args[++i] + "\"";
            else
            {
                Say("Unknown option " + a + ". Try --help.");
                return 2;
            }
        }
        if (help)
        {
            Console.WriteLine("Gatehouse");
            Console.WriteLine("  Gatehouse.exe                 start and open the interface");
            Console.WriteLine("  --no-browser                  do not open the browser");
            Console.WriteLine("  --check                       start, check it answers, stop (exit code 0 or 1)");
            Console.WriteLine("  --relay [--public-url URL]    also start the phone Relay (docs\\relay-local.md)");
            return 0;
        }

        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string appDir = Path.Combine(root, "app");
        string hostEntry = Path.Combine(appDir, "apps", "host", "src", "main.ts");
        if (!File.Exists(hostEntry))
        {
            Say("The application files were not found at " + appDir + ". Keep Gatehouse.exe next to its app folder.");
            return 1;
        }
        string node = FindNode(root);
        if (node == null)
        {
            Say("No Node was found. Gatehouse needs runtime\\node.exe next to it, or Node 22 or newer on the PATH.");
            return 1;
        }

        MakeJob();
        Console.CancelKeyPress += delegate(object s, ConsoleCancelEventArgs e)
        {
            e.Cancel = true;
            Say("Stopping...");
            StopAll();
            Environment.Exit(0);
        };

        string url = null;
        ManualResetEvent ready = new ManualResetEvent(false);
        Regex readyLine = new Regex("\"event\"\\s*:\\s*\"ready\".*?\"url\"\\s*:\\s*\"([^\"]+)\"");
        try
        {
            host = Start(node, appDir, hostEntry, "");
            host.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data == null) return;
                Match m = readyLine.Match(e.Data);
                if (m.Success)
                {
                    url = m.Groups[1].Value;
                    ready.Set();
                }
                else Console.WriteLine(e.Data);
            };
            host.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data != null) Console.WriteLine(e.Data);
            };
            host.BeginOutputReadLine();
            host.BeginErrorReadLine();

            Say("Starting (the first start can take a minute)...");
            int waited = 0;
            while (!ready.WaitOne(500))
            {
                waited += 500;
                if (host.HasExited)
                {
                    Say("The Host stopped before it was ready. The messages above say why.");
                    return 1;
                }
                if (waited > 180000)
                {
                    Say("The Host did not become ready in 3 minutes.");
                    return 1;
                }
            }
            Say("Ready.");
            Say("Open: " + url);
            Say("The part after #token= is private to this run. Do not share it.");

            if (withRelay)
            {
                string relayEntry = Path.Combine(appDir, "apps", "relay", "src", "main.ts");
                Say("Starting the Relay...");
                relay = Start(node, appDir, relayEntry, relayArgs);
                relay.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Console.WriteLine(e.Data); };
                relay.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Console.WriteLine(e.Data); };
                relay.BeginOutputReadLine();
                relay.BeginErrorReadLine();
            }

            if (check)
            {
                bool ok = false;
                try
                {
                    string baseUrl = url.Substring(0, url.IndexOf('/', 8));
                    string token = url.Substring(url.IndexOf("#token=") + 7);
                    System.Net.WebClient c = new System.Net.WebClient();
                    c.Headers.Add("Authorization", "Bearer " + token);
                    string body = c.DownloadString(baseUrl + "/api/state");
                    bool refused = false;
                    try { new System.Net.WebClient().DownloadString(baseUrl + "/api/state"); }
                    catch (System.Net.WebException) { refused = true; }
                    ok = body.Contains("\"type\":\"hello\"") && refused;
                }
                catch (Exception ex)
                {
                    Say("Check error: " + ex.Message);
                }
                Say(ok ? "Check passed: the Host answers with its token and refuses without it." : "Check failed.");
                return ok ? 0 : 1;
            }

            if (!noBrowser)
            {
                try { OpenBrowser(url); }
                catch (Exception ex) { Say("Could not open the browser (" + ex.Message + "). Open the address above yourself."); }
            }
            Say("Running. Close this window or press Ctrl+C to stop.");
            host.WaitForExit();
            Say("The Host stopped (exit code " + host.ExitCode + ").");
            return host.ExitCode;
        }
        finally
        {
            StopAll();
        }
    }
}
