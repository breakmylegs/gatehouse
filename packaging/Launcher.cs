// JCVC-Console.exe: starts Gatehouse in a console window, for troubleshooting and scripts.
// The normal way to run Gatehouse is JCVC.exe, which has its own window.
//
// Layout next to this file: runtime\node.exe and app\ (see docs/packaging.md).
// It starts the Host (which starts the Approver), prints the one-time address, and opens it in your browser
// unless told not to. Ctrl+C stops everything.
//
// Written in C# 5 so the compiler that ships with Windows can build it (no SDK needed).

using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;

internal static class Launcher
{
    private static Process host;
    private static Process relay;

    private static void Say(string text)
    {
        Console.WriteLine("[gatehouse] " + text);
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
            Console.WriteLine("JCVC-Console");
            Console.WriteLine("  JCVC-Console.exe         start; the address is opened in your browser");
            Console.WriteLine("  --no-browser                  do not open the browser");
            Console.WriteLine("  --check                       start, check it answers, stop (exit code 0 or 1)");
            Console.WriteLine("  --relay [--public-url URL]    also start the phone Relay (docs\\relay-local.md)");
            Console.WriteLine("Use JCVC.exe for the normal window.");
            return 0;
        }

        string root = Hosting.Root();
        string appDir = Hosting.AppDir(root);
        string hostEntry = Path.Combine(appDir, "apps", "host", "src", "main.ts");
        if (!File.Exists(hostEntry))
        {
            Say("The application files were not found at " + appDir + ". Keep this file next to its app folder.");
            return 1;
        }
        string node = Hosting.FindNode(root);
        if (node == null)
        {
            Say("No Node was found. JCVC needs runtime\\node.exe next to it, or Node 22 or newer on the PATH.");
            return 1;
        }

        Console.CancelKeyPress += delegate(object s, ConsoleCancelEventArgs e)
        {
            e.Cancel = true;
            Say("Stopping...");
            Hosting.StopChildren(relay, host);
            Environment.Exit(0);
        };

        string linkNote = Hosting.FixLinks(node, appDir);
        if (linkNote != null) Say(linkNote);

        string url = null;
        ManualResetEvent ready = new ManualResetEvent(false);
        try
        {
            host = Hosting.StartChild(node, appDir, hostEntry, "");
            host.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data == null) return;
                Match m = Hosting.ReadyLine.Match(e.Data);
                if (m.Success)
                {
                    url = m.Groups[1].Value;
                    ready.Set();
                }
                else if (Hosting.ApplyLine.IsMatch(e.Data))
                {
                    string message;
                    if (Hosting.StartUpdater(e.Data, out message))
                    {
                        Say("Updating: JCVC closes now and the new version opens in its window.");
                        Hosting.StopChildren(relay, host);
                        Environment.Exit(0);
                    }
                    Say(message);
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
                relay = Hosting.StartChild(node, appDir, relayEntry, relayArgs);
                relay.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Console.WriteLine(e.Data); };
                relay.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Console.WriteLine(e.Data); };
                relay.BeginOutputReadLine();
                relay.BeginErrorReadLine();
            }

            if (check)
            {
                string msg;
                bool ok = Hosting.CheckHost(url, out msg);
                Say(ok ? "Check passed: " + msg + "." : "Check failed: " + msg + ".");
                return ok ? 0 : 1;
            }

            if (!noBrowser)
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo(url);
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                }
                catch (Exception ex) { Say("Could not open the browser (" + ex.Message + "). Open the address above yourself."); }
            }
            Say("Running. Press Ctrl+C to stop.");
            host.WaitForExit();
            Say("The Host stopped (exit code " + host.ExitCode + ").");
            return host.ExitCode;
        }
        finally
        {
            Hosting.StopChildren(relay, host);
        }
    }
}
