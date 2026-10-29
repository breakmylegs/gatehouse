// JCVC-Update.exe: switches JCVC to another version after JCVC has closed, starts it, and goes back by itself if it
// does not start. JCVC builds and checks the new version beside the current one first (JCVC.next next to JCVC), so
// this program only renames folders, carries your own files across, starts the result and waits for it to say so.
//
//   JCVC-Update.exe --plan <plan.txt> [--wait <pid>] [--quiet]   what JCVC runs (the plan says what to switch to)
//   JCVC-Update.exe --rollback                                   by hand, from the install folder: back to the
//                                                                version kept beside it (JCVC.previous)
//
// Written in C# 5 so the compiler that ships with Windows can build it. It does not use WebView2.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

internal static class Updater
{
    [STAThread]
    private static int Main(string[] args)
    {
        string planFile = null;
        int waitPid = 0;
        bool quiet = false, rollback = false;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--plan" && i + 1 < args.Length) planFile = args[++i];
            else if (args[i] == "--wait" && i + 1 < args.Length) int.TryParse(args[++i], out waitPid);
            else if (args[i] == "--quiet") quiet = true;
            else if (args[i] == "--rollback") rollback = true;
        }
        Dictionary<string, string> plan;
        try
        {
            if (planFile != null) plan = Switch.ReadPlan(planFile);
            else if (rollback) plan = Switch.RollbackPlanHere();
            else
            {
                Tell(quiet, "JCVC-Update.exe is run by JCVC when you choose Update. To go back to the version kept beside this one, run it with --rollback.");
                return 2;
            }
        }
        catch (Exception ex)
        {
            Tell(quiet, ex.Message);
            return 2;
        }

        Switch work = new Switch(plan, waitPid);
        if (quiet) return work.Run();

        // A small window while JCVC is closed: what is happening, with a moving bar. It goes once the new version
        // has been started (its own start-up picture takes over).
        Application.EnableVisualStyles();
        Form f = new Form();
        f.Text = "Jean-Claude Van Code";
        f.FormBorderStyle = FormBorderStyle.FixedDialog;
        f.MaximizeBox = false;
        f.MinimizeBox = false;
        f.StartPosition = FormStartPosition.CenterScreen;
        f.ClientSize = new Size(440, 110);
        f.BackColor = Color.FromArgb(18, 22, 30);
        Label text = new Label();
        text.ForeColor = Color.FromArgb(214, 220, 232);
        text.Font = new Font("Segoe UI", 10.5f);
        text.SetBounds(20, 18, 400, 48);
        text.Text = "Updating JCVC to " + work.To + ".";
        ProgressBar bar = new ProgressBar();
        bar.Style = ProgressBarStyle.Marquee;
        bar.MarqueeAnimationSpeed = 28;
        bar.SetBounds(20, 74, 400, 10);
        f.Controls.Add(text);
        f.Controls.Add(bar);
        int code = 0;
        work.Say = delegate(string s) { try { f.BeginInvoke((Action)delegate { text.Text = s; }); } catch (Exception) { } };
        work.Started = delegate { try { f.BeginInvoke((Action)delegate { f.Hide(); }); } catch (Exception) { } };
        f.Shown += delegate
        {
            Thread t = new Thread(delegate()
            {
                code = work.Run();
                try { f.BeginInvoke((Action)delegate { f.Close(); }); } catch (Exception) { }
            });
            t.IsBackground = true;
            t.Start();
        };
        Application.Run(f);
        return code;
    }

    private static void Tell(bool quiet, string message)
    {
        if (quiet) Console.Error.WriteLine(message);
        else MessageBox.Show(message, "Jean-Claude Van Code", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }
}

internal sealed class Switch
{
    private readonly Dictionary<string, string> plan;
    private readonly int waitPid;
    private readonly string mode, install, candidate, previous, from, health, result;
    private readonly int timeoutSeconds;
    private readonly string log;
    internal readonly string To;
    internal Action<string> Say = delegate { };
    internal Action Started = delegate { };

    internal Switch(Dictionary<string, string> plan, int waitPid)
    {
        this.plan = plan;
        this.waitPid = waitPid;
        mode = Need("mode");
        install = Full(Need("install"));
        candidate = Full(Need("candidate"));
        previous = Full(Need("previous"));
        from = Need("from");
        To = Need("to");
        health = Full(Need("health"));
        result = Full(Need("result"));
        int t;
        timeoutSeconds = plan.ContainsKey("timeout") && int.TryParse(plan["timeout"], out t) && t > 0 ? t : 240;
        log = Path.Combine(Path.GetDirectoryName(result), "update.log");
    }

    private string Need(string key)
    {
        string v;
        if (!plan.TryGetValue(key, out v) || v.Length == 0) throw new InvalidDataException("The update plan has no " + key + ".");
        return v;
    }

    private static string Full(string p)
    {
        if (!Path.IsPathRooted(p)) throw new InvalidDataException("The update plan has a path that is not complete: " + p);
        return Path.GetFullPath(p).TrimEnd(Path.DirectorySeparatorChar);
    }

    internal static Dictionary<string, string> ReadPlan(string file)
    {
        Dictionary<string, string> d = new Dictionary<string, string>();
        foreach (string line in File.ReadAllLines(file))
        {
            int i = line.IndexOf('=');
            if (i > 0) d[line.Substring(0, i).Trim()] = line.Substring(i + 1).Trim();
        }
        return d;
    }

    /// <summary>Run by hand from the install folder: go back to the version kept beside it.</summary>
    internal static Dictionary<string, string> RollbackPlanHere()
    {
        string install = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string previous = install + ".previous";
        if (!File.Exists(Path.Combine(previous, "release.json")))
            throw new InvalidOperationException("There is no earlier version kept beside " + install + " to go back to.");
        foreach (Process p in Process.GetProcessesByName("JCVC"))
        {
            try
            {
                if (string.Equals(Path.GetDirectoryName(p.MainModule.FileName), install, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("JCVC is running. Quit it from the tray icon first, then run this again.");
            }
            catch (System.ComponentModel.Win32Exception) { }
        }
        string data = Environment.GetEnvironmentVariable("GATEHOUSE_DATA_DIR");
        if (string.IsNullOrEmpty(data)) data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Gatehouse");
        string updates = Path.Combine(data, "updates");
        Directory.CreateDirectory(updates);
        Dictionary<string, string> d = new Dictionary<string, string>();
        d["mode"] = "rollback";
        d["install"] = install;
        d["candidate"] = previous;
        d["previous"] = previous;
        d["from"] = VersionIn(install) ?? "unknown";
        d["to"] = VersionIn(previous) ?? "unknown";
        d["health"] = Path.Combine(updates, "started.json");
        d["result"] = Path.Combine(updates, "result.txt");
        return d;
    }

    private static string VersionIn(string dir)
    {
        try
        {
            Match m = Regex.Match(File.ReadAllText(Path.Combine(dir, "release.json")), "\"version\"\\s*:\\s*\"([^\"]+)\"");
            return m.Success ? m.Groups[1].Value : null;
        }
        catch (Exception) { return null; }
    }

    private void Log(string line)
    {
        try { File.AppendAllText(log, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + line + Environment.NewLine); }
        catch (Exception) { }
    }

    internal int Run()
    {
        try
        {
            return RunInner();
        }
        catch (Exception ex)
        {
            // JCVC has already closed: whatever happened, start the version that is in place, so it is never left off.
            Log("stopped: " + ex.Message);
            WriteResult(false, "The switch stopped: " + ex.Message);
            try { if (File.Exists(Path.Combine(install, "JCVC.exe"))) Launch(); } catch (Exception) { }
            return 1;
        }
    }

    private int RunInner()
    {
        Log(mode + " " + from + " -> " + To + " in " + install);
        // Only folders beside the install folder, named after it, are ever moved.
        string parent = Path.GetDirectoryName(install);
        string name = Path.GetFileName(install);
        foreach (string p in new string[] { candidate, previous })
            if (!string.Equals(Path.GetDirectoryName(p), parent, StringComparison.OrdinalIgnoreCase) ||
                !Path.GetFileName(p).StartsWith(name + ".", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("The update plan names a folder that is not beside " + install + ": " + p);
        if (mode != "apply" && mode != "rollback") throw new InvalidDataException("The update plan's mode is " + mode + ".");
        if (!File.Exists(Path.Combine(candidate, "JCVC.exe"))) throw new InvalidDataException("There is no JCVC.exe in " + candidate + ".");
        if (!Directory.Exists(install)) throw new InvalidDataException(install + " does not exist.");

        Say("Waiting for JCVC to close.");
        WaitForExit(waitPid, 60);

        Say("Switching to version " + To + ".");
        string stamp = DateTime.Now.Ticks.ToString();
        if (mode == "apply")
        {
            if (Directory.Exists(previous)) Move(previous, install + ".old-" + stamp);
            Move(install, previous);
            try { Move(candidate, install); }
            catch (Exception) { Move(previous, install); throw; }
        }
        else
        {
            string hold = install + ".swap-" + stamp;
            Move(install, hold);
            try { Move(previous, install); }
            catch (Exception) { Move(hold, install); throw; }
            Move(hold, previous);
        }
        // previous now holds the version being left.
        Process started = null;
        string why;
        bool healthy;
        try
        {
            CarryYourFiles(previous, install);
            SetInstalledVersion(To);
            Say("Starting version " + To + ".");
            try { File.Delete(health); } catch (Exception) { }
            started = Launch();
            Started();
            healthy = WaitHealthy(started, out why);
        }
        catch (Exception ex)
        {
            healthy = false;
            why = "It could not be started: " + ex.Message;
        }
        if (healthy)
        {
            Log("version " + To + " started");
            WriteResult(true, null);
            foreach (string d in Directory.GetDirectories(parent, name + ".old-*"))
                try { Directory.Delete(d, true); } catch (Exception) { }
            return 0;
        }

        // It did not start: put the version that worked back, and start it.
        Log("version " + To + " did not start: " + why);
        Say("Version " + To + " did not start. Going back to " + from + ".");
        try { if (started != null && !started.HasExited) { started.Kill(); started.WaitForExit(15000); } } catch (Exception) { }
        string failed = install + ".failed-" + stamp;
        Move(install, failed);
        Move(previous, install);
        if (mode == "rollback") Move(failed, previous);
        SetInstalledVersion(from);
        try { File.Delete(health); } catch (Exception) { }
        Launch();
        WriteResult(false, why);
        return 1;
    }

    private static void WaitForExit(int pid, int seconds)
    {
        if (pid <= 0) return;
        try
        {
            Process p = Process.GetProcessById(pid);
            p.WaitForExit(seconds * 1000);
        }
        catch (ArgumentException) { } // already gone
    }

    /// <summary>Renames a folder, retrying for a minute while a closing program or a virus scan still holds it.</summary>
    private void Move(string from, string to)
    {
        Exception last = null;
        for (int i = 0; i < 120; i++)
        {
            try
            {
                Directory.Move(from, to);
                Log("moved " + from + " -> " + to);
                return;
            }
            catch (IOException ex) { last = ex; }
            catch (UnauthorizedAccessException ex) { last = ex; }
            Thread.Sleep(500);
        }
        throw new IOException("Could not move " + from + " to " + to + ": " + (last == null ? "" : last.Message));
    }

    /// <summary>
    /// Your files go with you: your policy (rules, remembered decisions, project overlays) but not the shipped rule
    /// library, and anything at the top of the old folder the new one does not have (such as the uninstaller).
    /// </summary>
    private void CarryYourFiles(string fromDir, string toDir)
    {
        string policy = Path.Combine(fromDir, "app", "policy");
        string library = Path.Combine(policy, "library") + Path.DirectorySeparatorChar;
        if (Directory.Exists(policy))
            foreach (string f in Directory.GetFiles(policy, "*", SearchOption.AllDirectories))
            {
                if (f.StartsWith(library, StringComparison.OrdinalIgnoreCase)) continue;
                string dest = Path.Combine(toDir, f.Substring(fromDir.Length + 1));
                Directory.CreateDirectory(Path.GetDirectoryName(dest));
                File.Copy(f, dest, true);
            }
        foreach (string f in Directory.GetFiles(fromDir))
        {
            string dest = Path.Combine(toDir, Path.GetFileName(f));
            if (!File.Exists(dest)) File.Copy(f, dest);
        }
        Log("carried your policy files across");
    }

    /// <summary>Keeps Windows' list of installed apps right, when JCVC was installed with JCVC-Setup.exe here.</summary>
    private void SetInstalledVersion(string version)
    {
        try
        {
            using (Microsoft.Win32.RegistryKey k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                       "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{6C1E5B0A-2F1D-4F3B-9D6E-6B7A0C2E41A7}_is1", true))
            {
                if (k == null) return;
                string at = (k.GetValue("InstallLocation") as string ?? "").TrimEnd(Path.DirectorySeparatorChar);
                if (string.Equals(at, install, StringComparison.OrdinalIgnoreCase)) k.SetValue("DisplayVersion", version);
            }
        }
        catch (Exception) { }
    }

    private Process Launch()
    {
        ProcessStartInfo psi = new ProcessStartInfo(Path.Combine(install, "JCVC.exe"));
        psi.WorkingDirectory = install;
        psi.UseShellExecute = false;
        return Process.Start(psi);
    }

    /// <summary>The new version is healthy once its Host writes started.json with its version.</summary>
    private bool WaitHealthy(Process p, out string why)
    {
        DateTime until = DateTime.UtcNow.AddSeconds(timeoutSeconds);
        while (DateTime.UtcNow < until)
        {
            try
            {
                if (File.Exists(health))
                {
                    Match m = Regex.Match(File.ReadAllText(health), "\"version\"\\s*:\\s*\"([^\"]+)\"");
                    if (m.Success && m.Groups[1].Value == To) { why = null; return true; }
                }
            }
            catch (IOException) { }
            if (p.HasExited)
            {
                why = "It closed before it was ready (exit code " + p.ExitCode + ").";
                return false;
            }
            Thread.Sleep(500);
        }
        why = "It did not say it was ready within " + timeoutSeconds + " seconds.";
        return false;
    }

    private void WriteResult(bool ok, string reason)
    {
        StringBuilder b = new StringBuilder();
        b.Append("ok=").Append(ok ? "true" : "false").Append("\r\n");
        b.Append("mode=").Append(mode).Append("\r\n");
        b.Append("from=").Append(from).Append("\r\n");
        b.Append("to=").Append(To).Append("\r\n");
        if (reason != null) b.Append("reason=").Append(reason.Replace("\r", " ").Replace("\n", " ")).Append("\r\n");
        b.Append("at=").Append(DateTime.UtcNow.ToString("o")).Append("\r\n");
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(result));
            File.WriteAllText(result + ".tmp", b.ToString());
            if (File.Exists(result)) File.Delete(result);
            File.Move(result + ".tmp", result);
        }
        catch (Exception ex) { Log("could not write the result: " + ex.Message); }
    }
}
