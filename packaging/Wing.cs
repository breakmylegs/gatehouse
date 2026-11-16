// O37 (owner, 16 Nov: "Where a feature pushed to github appears to be mac only I always want you to take the code and make
// a windows version of the feature as well"): the Windows version of the Mac's wing beside the notch. While something
// waits on you, a small black pill sits at the top centre of the screen you are using, with how many and the highest
// risk; a click opens the list, with the same Deny and Allow once as a row of Approvals. It is the same page as the
// Mac's (?view=notch, NotchMac.tsx), told it is free of a notch. It never takes the focus or a taskbar button, follows
// the pointer from screen to screen, and the tray's "Show requests at the top of the screen" turns it off.
//
// Written in C# 5 so the compiler that ships with Windows can build it.

using System;
using System.Drawing;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class RequestWing : Form
{
    private const int WS_EX_TOPMOST = 0x00000008;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_NOACTIVATE = 0x08000000;

    /// <summary>A request id as the broker makes them: nothing else is passed on to the main window.</summary>
    internal static readonly Regex RequestId = new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");

    private readonly WebView2 web = new WebView2();
    private readonly Action<CoreWebView2> guard;
    private readonly Action<string> onOpen;
    private readonly Timer follow = new Timer();
    private Size wanted = new Size(0, 0);
    private bool on = true;

    /// <param name="onOpen">A request to show in full, by its id: the main window, on Approvals.</param>
    internal RequestWing(Action<CoreWebView2> guard, Action<string> onOpen)
    {
        this.guard = guard;
        this.onOpen = onOpen;
        Text = "Codehouse requests";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Size = new Size(1, 1);
        BackColor = Color.Black;
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.Black;
        Controls.Add(web);
        // Where you are now: checked once a second while it shows, and moved when you go to another screen.
        follow.Interval = 1000;
        follow.Tick += delegate { Place(); };
    }

    // Shown without taking the focus from what you are doing, and kept off the taskbar and Alt+Tab.
    protected override bool ShowWithoutActivation { get { return true; } }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            return cp;
        }
    }

    /// <summary>Whether it shows at all (the tray's switch). Off, it hides at once and stays hidden.</summary>
    internal bool On
    {
        get { return on; }
        set
        {
            on = value;
            if (!on) HideWing();
            else if (wanted.Width > 0) ShowWing();
        }
    }

    internal async Task Prepare(CoreWebView2Environment env, string wingUrl)
    {
        await web.EnsureCoreWebView2Async(env);
        CoreWebView2 core = web.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsBuiltInErrorPageEnabled = false;
        guard(core);
        core.PermissionRequested += delegate(object s, CoreWebView2PermissionRequestedEventArgs e)
        {
            e.State = CoreWebView2PermissionState.Deny;
        };
        // No notch on Windows: the page draws the pill it draws on a Mac screen without one.
        core.NavigationCompleted += delegate { try { core.PostWebMessageAsString("notch-place:free"); } catch (Exception) { } };
        core.WebMessageReceived += delegate(object s, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string m = null;
            try { m = e.TryGetWebMessageAsString(); } catch (Exception) { }
            if (m == null) return;
            Handle(m);
        };
        core.Navigate(wingUrl);
    }

    /// <summary>What the page asks of its window: hide, a size to show at, or a request to open in full.</summary>
    internal void Handle(string m)
    {
        if (m == "notch:hide")
        {
            wanted = new Size(0, 0);
            HideWing();
            return;
        }
        if (m.StartsWith("notch:size:"))
        {
            Size s;
            if (!TryParseSize(m.Substring("notch:size:".Length), out s)) return;
            wanted = s;
            if (on) ShowWing();
            return;
        }
        if (m.StartsWith("notch-open:"))
        {
            string id = m.Substring("notch-open:".Length);
            if (RequestId.IsMatch(id)) onOpen(id);
        }
    }

    /// <summary>"width:height" in CSS pixels, each from 1 to 2000, or nothing.</summary>
    internal static bool TryParseSize(string text, out Size size)
    {
        size = new Size(0, 0);
        string[] parts = text.Split(':');
        int w, h;
        if (parts.Length != 2 || !int.TryParse(parts[0], out w) || !int.TryParse(parts[1], out h)) return false;
        if (w < 1 || h < 1 || w > 2000 || h > 2000) return false;
        size = new Size(w, h);
        return true;
    }

    /// <summary>The top centre of the screen the pointer is on, a little below its top edge, for a wing this big.</summary>
    internal static Point TopCentre(Rectangle screen, Size wing)
    {
        return new Point(screen.Left + (screen.Width - wing.Width) / 2, screen.Top + 6);
    }

    private void ShowWing()
    {
        float scale = 1f;
        try { using (Graphics g = CreateGraphics()) scale = g.DpiX / 96f; } catch (Exception) { }
        Size = new Size((int)Math.Ceiling(wanted.Width * scale), (int)Math.Ceiling(wanted.Height * scale));
        Place();
        if (!Visible) Show();
        follow.Start();
    }

    private void HideWing()
    {
        follow.Stop();
        if (Visible) Hide();
    }

    private void Place()
    {
        Rectangle area = Screen.FromPoint(Cursor.Position).WorkingArea;
        Point at = TopCentre(area, Size);
        if (Location != at) Location = at;
    }
}
