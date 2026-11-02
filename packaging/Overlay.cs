// The quick prompt (W1-15): a small window over whatever you are doing, opened by the shortcut or the tray, that
// starts a chat or messages the session you were working in. It is made hidden once the main window has loaded, so
// opening it only shows it. Esc hides it and gives the focus back to the program you were in.
//
// Written in C# 5 so the compiler that ships with Windows can build it.

using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class QuickOverlay : Form
{
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    private readonly WebView2 web = new WebView2();
    private readonly Func<string, bool> isOurs;
    private readonly Action<string> openExternal;
    private readonly Action<string> onOpen;
    private IntPtr before;
    private bool ready;

    /// <param name="onOpen">Told what was sent (a little JSON: the session and your words) so the main window shows it.</param>
    internal QuickOverlay(Func<string, bool> isOurs, Action<string> openExternal, Action<string> onOpen)
    {
        this.isOurs = isOurs;
        this.openExternal = openExternal;
        this.onOpen = onOpen;
        Text = "Codehouse quick prompt";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Size = new Size(680, 300);
        BackColor = Color.FromArgb(18, 22, 30);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.FromArgb(18, 22, 30);
        Controls.Add(web);
        // Clicking somewhere else puts it away; the focus stays where you clicked.
        Deactivate += delegate { if (Visible) Hide(); };
    }

    // Not in Alt+Tab: a tool window.
    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams p = base.CreateParams;
            p.ExStyle |= 0x80; // WS_EX_TOOLWINDOW
            return p;
        }
    }

    internal bool Ready { get { return ready; } }

    /// <summary>Loads the quick page, hidden, in the main window's WebView2 environment.</summary>
    internal async Task Prepare(CoreWebView2Environment env, string quickUrl)
    {
        IntPtr made = Handle; // the window must exist before WebView2 can sit in it
        if (made == IntPtr.Zero) return;
        await web.EnsureCoreWebView2Async(env);
        CoreWebView2 core = web.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.IsBuiltInErrorPageEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = true;
        core.NavigationStarting += delegate(object s, CoreWebView2NavigationStartingEventArgs e)
        {
            if (!isOurs(e.Uri)) { e.Cancel = true; openExternal(e.Uri); }
        };
        core.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            if (!isOurs(e.Uri)) openExternal(e.Uri);
        };
        core.PermissionRequested += delegate(object s, CoreWebView2PermissionRequestedEventArgs e)
        {
            e.State = CoreWebView2PermissionState.Deny;
        };
        core.WebMessageReceived += delegate(object s, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string m = null;
            try { m = e.TryGetWebMessageAsString(); } catch (Exception) { }
            if (m == null) return;
            if (m == "quick-close") PutAway(true);
            else if (m.StartsWith("quick-open:"))
            {
                PutAway(false);
                onOpen(m.Substring("quick-open:".Length));
            }
        };
        core.NavigationCompleted += delegate(object s, CoreWebView2NavigationCompletedEventArgs e) { ready = e.IsSuccess; };
        core.Navigate(quickUrl);
    }

    /// <summary>Shows it over the program you are in, a third of the way down the screen the pointer is on.</summary>
    internal void Open()
    {
        before = GetForegroundWindow();
        Rectangle area = Screen.FromPoint(Cursor.Position).WorkingArea;
        Location = new Point(area.Left + (area.Width - Width) / 2, area.Top + area.Height / 4);
        Show();
        Activate();
        SetForegroundWindow(Handle);
        web.Focus();
        try { web.CoreWebView2.PostWebMessageAsString("quick-shown"); } catch (Exception) { }
    }

    /// <summary>Hides it. After Esc the focus goes back to the program you were in.</summary>
    internal void PutAway(bool giveBack)
    {
        if (!Visible) return;
        Hide();
        if (giveBack && before != IntPtr.Zero && before != Handle) SetForegroundWindow(before);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        // Alt+F4 puts it away; it closes with Codehouse.
        if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; PutAway(true); return; }
        base.OnFormClosing(e);
    }
}
