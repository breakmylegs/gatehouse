// Shared by JCVC.exe (the window app) and JCVC-Console.exe (the console launcher):
// finding Node, starting the Host and the Relay as children, and making sure they all stop with the launcher.
//
// Written in C# 5 so the compiler that ships with Windows can build it (no SDK needed).

using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

internal static class Hosting
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

    /// <summary>The line the Host prints when it is ready: {"event":"ready",...,"url":"http://127.0.0.1:PORT/#token=..."}</summary>
    internal static readonly Regex ReadyLine = new Regex("\"event\"\\s*:\\s*\"ready\".*?\"url\"\\s*:\\s*\"([^\"]+)\"");

    /// <summary>The line the Host prints to switch versions: {"event":"apply-update","updater":"...","plan":"..."}</summary>
    internal static readonly Regex ApplyLine = new Regex(@"""event""\s*:\s*""apply-update""");

    /// <summary>A start-up step the Host reports: {"event":"progress","text":"Loading your rules"}</summary>
    internal static readonly Regex ProgressLine = new Regex(@"""event""\s*:\s*""progress""");

    /// <summary>A string field from a one-line JSON object, with JSON's escapes undone.</summary>
    internal static string JsonField(string line, string name)
    {
        Match m = Regex.Match(line, @"""" + Regex.Escape(name) + @"""\s*:\s*""((?:[^""\\]|\\.)*)""");
        if (!m.Success) return null;
        string v = m.Groups[1].Value;
        StringBuilder b = new StringBuilder();
        char slash = (char)92;
        for (int i = 0; i < v.Length; i++)
        {
            char c = v[i];
            if (c != slash || i + 1 >= v.Length) { b.Append(c); continue; }
            char n = v[++i];
            if (n == 'u' && i + 4 < v.Length) { b.Append((char)Convert.ToInt32(v.Substring(i + 1, 4), 16)); i += 4; }
            else if (n == 'n') b.Append((char)10);
            else if (n == 'r') b.Append((char)13);
            else if (n == 't') b.Append((char)9);
            else b.Append(n);
        }
        return b.ToString();
    }

    /// <summary>
    /// Starts JCVC-Update.exe with the plan the Host wrote. It waits for this process to end, so the caller quits
    /// next. The updater is not put in the job, so it outlives JCVC.
    /// </summary>
    internal static bool StartUpdater(string line, out string message)
    {
        string updater = JsonField(line, "updater");
        string plan = JsonField(line, "plan");
        if (updater == null || plan == null || !File.Exists(updater) || !File.Exists(plan))
        {
            message = "the update could not start: its files were not found";
            return false;
        }
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(updater, "--plan \"" + plan + "\" --wait " + Process.GetCurrentProcess().Id);
            psi.UseShellExecute = false;
            psi.WorkingDirectory = Path.GetDirectoryName(updater);
            Process.Start(psi);
            message = "started";
            return true;
        }
        catch (Exception ex)
        {
            message = "the update could not start: " + ex.Message;
            return false;
        }
    }

    internal static void MakeJob()
    {
        if (job != IntPtr.Zero) return;
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

    internal static string FindNode(string root)
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

    /// <summary>
    /// Points the workspace links in app\node_modules\@gatehouse at this folder (scripts\links.mjs). npm makes them
    /// with absolute paths, so they need this after the folder is moved, installed or updated. Quick when they are right.
    /// </summary>
    internal static string FixLinks(string node, string appDir)
    {
        string script = Path.Combine(appDir, "scripts", "links.mjs");
        if (!File.Exists(script)) return null;
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(node, "\"" + script + "\" \"" + appDir + "\"");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardError = true;
            Process p = Process.Start(psi);
            string err = p.StandardError.ReadToEnd();
            if (!p.WaitForExit(30000)) { try { p.Kill(); } catch (Exception) { } return "the workspace links were not checked in time"; }
            return p.ExitCode == 0 ? (err.Trim().Length > 0 ? err.Trim() : null) : "the workspace links could not be fixed: " + err.Trim();
        }
        catch (Exception ex) { return "the workspace links could not be checked: " + ex.Message; }
    }

    internal static Process StartChild(string node, string appDir, string entry, string extraArgs)
    {
        MakeJob();
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = node;
        // A built file (apps\<name>\dist\main.mjs) runs on Node directly; a TypeScript source goes through tsx.
        string run = entry.EndsWith(".mjs", StringComparison.OrdinalIgnoreCase)
            ? "\"" + entry + "\""
            : "\"" + Path.Combine(appDir, "node_modules", "tsx", "dist", "cli.mjs") + "\" \"" + entry + "\"";
        psi.Arguments = run + (string.IsNullOrEmpty(extraArgs) ? "" : " " + extraArgs);
        psi.WorkingDirectory = appDir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardInput = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        // The one clean way to ask a child to stop that works the same everywhere: close its input.
        psi.EnvironmentVariables["GATEHOUSE_EXIT_ON_STDIN_CLOSE"] = "1";
        psi.EnvironmentVariables["GATEHOUSE_PACKAGED"] = "1";
        // Node keeps the compiled code here, so the next start reuses it instead of compiling everything again.
        if (string.IsNullOrEmpty(psi.EnvironmentVariables["NODE_COMPILE_CACHE"]))
            psi.EnvironmentVariables["NODE_COMPILE_CACHE"] = Path.Combine(DataDir(), "node-cache");
        Process p = new Process();
        p.StartInfo = psi;
        p.Start();
        if (job != IntPtr.Zero) AssignProcessToJobObject(job, p.Handle);
        return p;
    }

    internal static void StopChildren(params Process[] children)
    {
        foreach (Process p in children)
        {
            if (p == null) continue;
            try { p.StandardInput.Close(); } catch (Exception) { }
        }
        foreach (Process p in children)
        {
            if (p == null) continue;
            try
            {
                if (!p.HasExited && !p.WaitForExit(5000)) p.Kill();
            }
            catch (Exception) { }
        }
    }

    /// <summary>The program to start for one of JCVC's parts: its built file if the package has one, else its source.</summary>
    internal static string Entry(string appDir, string name)
    {
        string built = Path.Combine(appDir, "apps", name, "dist", "main.mjs");
        return File.Exists(built) ? built : Path.Combine(appDir, "apps", name, "src", "main.ts");
    }

    /// <summary>%LOCALAPPDATA%\Gatehouse, or GATEHOUSE_DATA_DIR when it is set.</summary>
    internal static string DataDir()
    {
        string d = Environment.GetEnvironmentVariable("GATEHOUSE_DATA_DIR");
        return string.IsNullOrEmpty(d)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Gatehouse")
            : d;
    }

    internal static string AppDir(string root)
    {
        return Path.Combine(root, "app");
    }

    internal static string Root()
    {
        return AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    }

    /// <summary>The address a check can call, and its token, from the ready URL.</summary>
    internal static bool CheckHost(string url, out string message)
    {
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
            bool ok = body.Contains("\"type\":\"hello\"") && refused;
            message = ok ? "the Host answers with its token and refuses without it" : "the Host did not behave as expected";
            return ok;
        }
        catch (Exception ex)
        {
            message = "check error: " + ex.Message;
            return false;
        }
    }
}
