// Gatehouse.exe: the Gatehouse window. A native Windows window that shows the Gatehouse interface with
// Microsoft's WebView2 (the same engine Edge uses, installed with Windows 11). It is not a browser tab: it has
// its own icon, its own taskbar button, no address bar, and a tray icon so approvals still reach you when the
// window is closed.
//
// It starts the Host (which starts the Approver) from the folder around it:
//   Gatehouse.exe, runtime\node.exe, app\  (see docs/packaging.md)
//
// Options: --check (start, check, stop, exit code), --browser (use the default browser instead of this
// window), --relay [--public-url URL], --help.
//
// Written in C# 5 so the compiler that ships with Windows can build it (no SDK needed).

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class MainForm : Form
{
    [StructLayout(LayoutKind.Sequential)]
    private struct FlashInfo
    {
        public uint cbSize;
        public IntPtr hwnd;
        public uint dwFlags;
        public uint uCount;
        public uint dwTimeout;
    }

    [DllImport("user32.dll")]
    private static extern bool FlashWindowEx(ref FlashInfo info);

    private readonly bool check;
    private readonly bool withRelay;
    private readonly bool startInTray;
    private readonly string relayArgs;
    private readonly WebView2 web = new WebView2();
    private readonly Panel splash = new Panel();
    private readonly Label splashTitle = new Label();
    private readonly Label splashText = new Label();
    private readonly NotifyIcon tray = new NotifyIcon();
    private readonly StringBuilder log = new StringBuilder();
    private readonly string dataDir;
    private Process host;
    private Process relay;
    private string url;
    private string hostOrigin;
    private bool hostReady;
    private bool webReady;
    private bool navigated;
    private bool quitting;
    private bool toldAboutTray;
    private int checkExit = 1;
    private System.Windows.Forms.Timer timeout;

    internal MainForm(bool check, bool withRelay, string relayArgs, bool startInTray)
    {
        this.check = check;
        this.startInTray = startInTray && !check;
        this.withRelay = withRelay;
        this.relayArgs = relayArgs;
        dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Gatehouse");
        Text = "Jean-Claude Van Code";
        MinimumSize = new Size(900, 600);
        Size = new Size(1360, 860);
        StartPosition = FormStartPosition.CenterScreen;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
        BackColor = Color.FromArgb(244, 246, 249);

        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.FromArgb(244, 246, 249);
        Controls.Add(web);

        splash.Dock = DockStyle.Fill;
        splash.BackColor = Color.FromArgb(11, 11, 12);
        try
        {
            string pic = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "splash.png");
            if (File.Exists(pic))
            {
                using (MemoryStream ms = new MemoryStream(File.ReadAllBytes(pic))) splash.BackgroundImage = Image.FromStream(ms);
                splash.BackgroundImageLayout = ImageLayout.Zoom;
            }
        }
        catch (Exception) { }
        splashTitle.Text = "Jean-Claude Van Code";
        splashTitle.Font = new Font("Segoe UI", 22f, FontStyle.Bold);
        splashTitle.ForeColor = Color.White;
        splashTitle.BackColor = Color.FromArgb(150, 0, 0, 0);
        splashTitle.AutoSize = true;
        splashTitle.Location = new Point(48, 64);
        splashText.Text = "Starting. The first start can take a minute.";
        splashText.Font = new Font("Segoe UI", 11f);
        splashText.ForeColor = Color.White;
        splashText.BackColor = Color.Transparent;
        splashText.AutoSize = false;
        splashText.Location = new Point(52, 120);
        splashText.Size = new Size(900, 400);
        splashText.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom;
        splash.Controls.Add(splashTitle);
        splash.Controls.Add(splashText);
        Controls.Add(splash);
        splash.BringToFront();

        tray.Icon = Icon;
        tray.Text = "Jean-Claude Van Code";
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add("Open Gatehouse", null, delegate { ShowWindow(); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit Gatehouse", null, delegate { Quit(); });
        tray.ContextMenuStrip = menu;
        tray.MouseClick += delegate(object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) ShowWindow(); };
        tray.BalloonTipClicked += delegate { ShowWindow(); };
        tray.Visible = !check;

        if (check)
        {
            // Check mode shows nothing: a window that exists but is off screen and not in the taskbar.
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Location = new Point(-32000, -32000);
            timeout = new System.Windows.Forms.Timer();
            timeout.Interval = 240000;
            timeout.Tick += delegate { Say("Check failed: it did not finish in 4 minutes."); Finish(1); };
            timeout.Start();
        }
        else LoadBounds();
    }

    private static void Say(string text)
    {
        try { Console.WriteLine("[gatehouse] " + text); } catch (Exception) { }
    }

    // ---- window position ----

    private string BoundsFile { get { return Path.Combine(dataDir, "window.txt"); } }

    private void LoadBounds()
    {
        try
        {
            if (!File.Exists(BoundsFile)) return;
            string[] p = File.ReadAllText(BoundsFile).Trim().Split(' ');
            Rectangle r = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
            bool visible = false;
            foreach (Screen s in Screen.AllScreens) if (s.WorkingArea.IntersectsWith(r)) visible = true;
            if (!visible || r.Width < 600 || r.Height < 400) return;
            StartPosition = FormStartPosition.Manual;
            Bounds = r;
            if (p.Length > 4 && p[4] == "1") WindowState = FormWindowState.Maximized;
        }
        catch (Exception) { }
    }

    private void SaveBounds()
    {
        try
        {
            if (check || WindowState == FormWindowState.Minimized) return;
            Rectangle r = WindowState == FormWindowState.Normal ? Bounds : base.RestoreBounds;
            Directory.CreateDirectory(dataDir);
            File.WriteAllText(BoundsFile, r.X + " " + r.Y + " " + r.Width + " " + r.Height + " " + (WindowState == FormWindowState.Maximized ? "1" : "0"));
        }
        catch (Exception) { }
    }

    // ---- starting ----

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        // Started at sign-in: sit in the tray until a request needs you or you open it.
        if (startInTray) Hide();
        string root = Hosting.Root();
        string appDir = Hosting.AppDir(root);
        string hostEntry = Path.Combine(appDir, "apps", "host", "src", "main.ts");
        string node = Hosting.FindNode(root);
        if (!File.Exists(hostEntry)) { Fail("The application files were not found at " + appDir + ". Keep Gatehouse.exe next to its app folder."); return; }
        if (node == null) { Fail("No Node was found. Gatehouse needs runtime\\node.exe next to it."); return; }

        try
        {
            host = Hosting.StartChild(node, appDir, hostEntry, "");
            host.OutputDataReceived += delegate(object s, DataReceivedEventArgs ev)
            {
                if (ev.Data == null) return;
                Match m = Hosting.ReadyLine.Match(ev.Data);
                if (m.Success) OnUi(delegate { OnHostReady(m.Groups[1].Value); });
                else Remember(ev.Data);
            };
            host.ErrorDataReceived += delegate(object s, DataReceivedEventArgs ev) { if (ev.Data != null) Remember(ev.Data); };
            host.Exited += delegate { OnUi(delegate { OnHostExited(); }); };
            host.EnableRaisingEvents = true;
            host.BeginOutputReadLine();
            host.BeginErrorReadLine();
            if (withRelay)
            {
                relay = Hosting.StartChild(node, appDir, Path.Combine(appDir, "apps", "relay", "src", "main.ts"), relayArgs);
                relay.OutputDataReceived += delegate(object s, DataReceivedEventArgs ev) { if (ev.Data != null) Remember("[relay] " + ev.Data); };
                relay.ErrorDataReceived += delegate(object s, DataReceivedEventArgs ev) { if (ev.Data != null) Remember("[relay] " + ev.Data); };
                relay.BeginOutputReadLine();
                relay.BeginErrorReadLine();
            }
        }
        catch (Exception ex) { Fail("Could not start the Host: " + ex.Message); return; }

        try
        {
            string userData = Path.Combine(dataDir, "webview");
            Directory.CreateDirectory(userData);
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userData, null);
            await web.EnsureCoreWebView2Async(env);
            OnWebReady();
        }
        catch (Exception ex) { WebViewMissing(ex.Message); }
    }

    private void OnUi(Action a)
    {
        if (IsDisposed) return;
        if (InvokeRequired) { try { BeginInvoke(a); } catch (Exception) { } }
        else a();
    }

    private void Remember(string line)
    {
        lock (log)
        {
            log.AppendLine(line);
            if (log.Length > 6000) log.Remove(0, log.Length - 4000);
        }
        if (check) Say(line);
    }

    private string Tail()
    {
        lock (log)
        {
            string[] lines = log.ToString().Split(new char[] { '\n' }, StringSplitOptions.RemoveEmptyEntries);
            int from = Math.Max(0, lines.Length - 12);
            return string.Join(Environment.NewLine, lines, from, lines.Length - from).Trim();
        }
    }

    private void OnHostReady(string readyUrl)
    {
        url = readyUrl;
        hostReady = true;
        try { hostOrigin = new Uri(url).GetLeftPart(UriPartial.Authority); } catch (Exception) { hostOrigin = null; }
        Say("Ready: " + hostOrigin);
        if (check)
        {
            string msg;
            bool ok = Hosting.CheckHost(url, out msg);
            if (!ok) { Say("Check failed: " + msg + "."); Finish(1); return; }
            Say("Host check passed: " + msg + ".");
        }
        TryNavigate();
    }

    private void OnWebReady()
    {
        webReady = true;
        CoreWebView2 core = web.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = true;
        core.Settings.IsBuiltInErrorPageEnabled = false;
        core.NavigationStarting += delegate(object s, CoreWebView2NavigationStartingEventArgs e)
        {
            if (!IsOurs(e.Uri)) { e.Cancel = true; OpenExternal(e.Uri); }
        };
        core.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            if (!IsOurs(e.Uri)) OpenExternal(e.Uri);
        };
        core.PermissionRequested += delegate(object s, CoreWebView2PermissionRequestedEventArgs e)
        {
            // Only our own page is ever loaded, so notifications are the one thing it may ask for.
            e.State = e.PermissionKind == CoreWebView2PermissionKind.Notifications ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
        };
        core.WebMessageReceived += delegate(object s, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string m = null;
            try { m = e.TryGetWebMessageAsString(); } catch (Exception) { }
            if (m == "attention") Attention();
        };
        core.NavigationCompleted += delegate(object s, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (!e.IsSuccess) { Fail("The window could not load the Gatehouse interface (" + e.WebErrorStatus + ")."); return; }
            splash.Visible = false;
            if (check) CheckPage();
        };
        TryNavigate();
    }

    private bool IsOurs(string uri)
    {
        if (uri == null) return false;
        if (uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase) || uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return true;
        return hostOrigin != null && uri.StartsWith(hostOrigin, StringComparison.OrdinalIgnoreCase);
    }

    private static void OpenExternal(string uri)
    {
        try
        {
            Uri u = new Uri(uri);
            if (u.Scheme != "http" && u.Scheme != "https") return;
            ProcessStartInfo psi = new ProcessStartInfo(u.AbsoluteUri);
            psi.UseShellExecute = true;
            Process.Start(psi);
        }
        catch (Exception) { }
    }

    private void TryNavigate()
    {
        if (!hostReady || !webReady || navigated) return;
        navigated = true;
        splashText.Text = "Opening...";
        web.CoreWebView2.Navigate(url);
    }

    private async void CheckPage()
    {
        try
        {
            await System.Threading.Tasks.Task.Delay(1500);
            string result = await web.CoreWebView2.ExecuteScriptAsync(
                "JSON.stringify({title: document.title, children: (document.getElementById('root')||{children:[]}).children.length, text: document.body.innerText.slice(0,80)})");
            Say("Window page: " + result);
            bool ok = result.Contains("Jean-Claude Van Code") && !result.Contains("\\\"children\\\":0");
            Say(ok ? "Check passed: the window loaded the interface from the packaged Host." : "Check failed: the window did not show the interface.");
            Finish(ok ? 0 : 1);
        }
        catch (Exception ex)
        {
            Say("Check failed: " + ex.Message);
            Finish(1);
        }
    }

    private void WebViewMissing(string why)
    {
        // Without the WebView2 runtime the interface still works in the default browser. Say so, rather than doing it silently.
        Say("WebView2 is not available (" + why + ")");
        if (check) { Finish(1); return; }
        splashText.Text = "The Microsoft Edge WebView2 runtime is not available on this computer, so Gatehouse opened in your default browser instead. You can install the runtime from microsoft.com/edge/webview2 to get this window.";
        if (url != null) OpenExternal(url);
        else
        {
            System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
            t.Interval = 500;
            t.Tick += delegate { if (url != null) { t.Stop(); OpenExternal(url); } };
            t.Start();
        }
    }

    private void OnHostExited()
    {
        if (quitting) return;
        if (check) { Say("Check failed: the Host stopped.\r\n" + Tail()); Finish(1); return; }
        Fail("Gatehouse stopped unexpectedly.");
    }

    private void Fail(string message)
    {
        string t = Tail();
        Say(message + (t.Length > 0 ? "\r\n" + t : ""));
        if (check) { Finish(1); return; }
        splash.Visible = true;
        splash.BringToFront();
        splashTitle.ForeColor = Color.FromArgb(160, 30, 30);
        splashText.Text = message + (t.Length > 0 ? "\r\n\r\nWhat it said:\r\n" + t : "") + "\r\n\r\nClose this window to leave.";
        if (!Visible) ShowWindow();
        quitting = true; // closing now really closes
    }

    private void Finish(int code)
    {
        checkExit = code;
        quitting = true;
        Hosting.StopChildren(relay, host);
        Application.Exit();
    }

    // ---- being a good Windows citizen ----

    internal void ShowWindow()
    {
        if (!Visible) Show();
        ShowInTaskbar = true;
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
        TopMost = true;
        TopMost = false;
    }

    private void Attention()
    {
        if (ContainsFocus && Visible && WindowState != FormWindowState.Minimized) return;
        try
        {
            FlashInfo fi = new FlashInfo();
            fi.cbSize = (uint)Marshal.SizeOf(typeof(FlashInfo));
            fi.hwnd = Handle;
            fi.dwFlags = 0x0000000F; // FLASHW_ALL | FLASHW_TIMERNOFG
            fi.uCount = 5;
            if (Visible) FlashWindowEx(ref fi);
        }
        catch (Exception) { }
        // No detail in the balloon: it can show on a locked screen or be mirrored.
        tray.ShowBalloonTip(5000, "Jean-Claude Van Code", "Something needs your decision.", ToolTipIcon.Warning);
    }

    private void Quit()
    {
        quitting = true;
        SaveBounds();
        tray.Visible = false;
        Hosting.StopChildren(relay, host);
        Application.Exit();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!quitting && e.CloseReason == CloseReason.UserClosing && !check)
        {
            // Closing the window keeps Gatehouse running in the tray so approvals still reach you.
            e.Cancel = true;
            SaveBounds();
            Hide();
            if (!toldAboutTray)
            {
                toldAboutTray = true;
                tray.ShowBalloonTip(5000, "Gatehouse is still running", "Approvals still reach you. Use the tray icon to open it or quit.", ToolTipIcon.Info);
            }
            return;
        }
        base.OnFormClosing(e);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        tray.Visible = false;
        tray.Dispose();
        Hosting.StopChildren(relay, host);
        base.OnFormClosed(e);
    }

    internal int CheckExit { get { return checkExit; } }
}

internal static class Program
{
    [DllImport("kernel32.dll")]
    private static extern bool AttachConsole(int pid);

    [STAThread]
    private static int Main(string[] args)
    {
        AttachConsole(-1); // so --check and --help print in the terminal you ran them from
        bool check = false, browser = false, relay = false, help = false, inTray = false;
        string relayArgs = "";
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--check") check = true;
            else if (a == "--browser") browser = true;
            else if (a == "--relay") relay = true;
            else if (a == "--help" || a == "-h" || a == "/?") help = true;
            else if (a == "--tray") inTray = true;
            else if (a == "--no-browser") { }
            else if (a == "--public-url" && i + 1 < args.Length) relayArgs = "--public-url \"" + args[++i] + "\"";
            else
            {
                Console.WriteLine("[gatehouse] Unknown option " + a + ". Try --help.");
                return 2;
            }
        }
        if (help)
        {
            Console.WriteLine("Gatehouse");
            Console.WriteLine("  Gatehouse.exe                 open the Gatehouse window");
            Console.WriteLine("  --check                       start, check the window and Host, stop (exit code 0 or 1)");
            Console.WriteLine("  --relay [--public-url URL]    also start the phone Relay (docs\\relay-local.md)");
            Console.WriteLine("  --tray                        start hidden in the tray (what start at sign-in uses)");
            Console.WriteLine("  --browser                     use the default browser instead of this window");
            Console.WriteLine("Use Gatehouse-Console.exe for a console window with the Host's messages.");
            return 0;
        }
        if (browser)
        {
            // The console launcher does exactly this.
            string console = Path.Combine(Hosting.Root(), "Gatehouse-Console.exe");
            if (!File.Exists(console)) { Console.WriteLine("[gatehouse] Gatehouse-Console.exe was not found."); return 1; }
            Process p = Process.Start(console, relay ? "--relay " + relayArgs : "");
            p.WaitForExit();
            return p.ExitCode;
        }

        bool created;
        Mutex single = new Mutex(true, "Local\\Gatehouse.App", out created);
        if (!created && !check)
        {
            // Already running: bring that window forward instead of starting a second Host.
            try { EventWaitHandle.OpenExisting("Local\\Gatehouse.Show").Set(); } catch (Exception) { }
            return 0;
        }
        EventWaitHandle show = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\Gatehouse.Show");

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        MainForm form = new MainForm(check, relay, relayArgs, inTray);
        Thread watcher = new Thread(delegate()
        {
            while (show.WaitOne())
            {
                try { form.BeginInvoke((Action)delegate { form.ShowWindow(); }); } catch (Exception) { }
            }
        });
        watcher.IsBackground = true;
        watcher.Start();
        Application.Run(form);
        return check ? form.CheckExit : 0;
    }
}
