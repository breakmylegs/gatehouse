// A session in a window of its own (B16): the same page as the main window, at ?view=pane&session=<id>, in the main
// window's WebView2 environment, so the same token, Host and Origin checks apply. It only ever loads Codehouse's own
// pages; anything else opens in the browser. Closing it puts the session back in the main window.
//
// Written in C# 5 so the compiler that ships with Windows can build it.

using System;
using System.Drawing;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class PopoutWindow : Form
{
    /// <summary>A session id as the Host makes them: nothing else becomes part of the address.</summary>
    internal static readonly Regex SessionId = new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");

    private readonly WebView2 web = new WebView2();
    private readonly Func<string, bool> isOurs;
    private readonly Action<string> openExternal;

    internal readonly string Session;

    internal PopoutWindow(string session, Func<string, bool> isOurs, Action<string> openExternal)
    {
        Session = session;
        this.isOurs = isOurs;
        this.openExternal = openExternal;
        Text = "Codehouse";
        StartPosition = FormStartPosition.WindowsDefaultLocation;
        Size = new Size(900, 760);
        MinimumSize = new Size(420, 360);
        BackColor = Color.FromArgb(18, 22, 30);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.FromArgb(18, 22, 30);
        Controls.Add(web);
    }

    /// <summary>Loads the session's page in the main window's WebView2 environment, then shows the window.</summary>
    internal async Task Open(CoreWebView2Environment env, string paneUrl)
    {
        Show();
        await web.EnsureCoreWebView2Async(env);
        CoreWebView2 core = web.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = true;
        core.Settings.IsBuiltInErrorPageEnabled = false;
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
            e.State = e.PermissionKind == CoreWebView2PermissionKind.Notifications ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
        };
        core.DocumentTitleChanged += delegate { Text = core.DocumentTitle; };
        core.WebMessageReceived += delegate(object s, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string m = null;
            try { m = e.TryGetWebMessageAsString(); } catch (Exception) { }
            if (m == "pane-close") Close();
        };
        core.Navigate(paneUrl);
    }

    internal void Raise()
    {
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }
}
