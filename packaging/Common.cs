// Shared by Gatehouse.exe (the window app) and Gatehouse-Console.exe (the console launcher):
// finding Node, starting the Host and the Relay as children, and making sure they all stop with the launcher.
//
// Written in C# 5 so the compiler that ships with Windows can build it (no SDK needed).

using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
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

    internal static Process StartChild(string node, string appDir, string entry, string extraArgs)
    {
        MakeJob();
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
