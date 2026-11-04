// CH-01 (owner's Chat build, 4 Nov 2026): Codehouse's windows show only Codehouse's own page. A navigation away from
// it is cancelled, a link the page opens goes to your default browser instead, and the Host audits each one. No
// claude.ai or Anthropic sign-in page is ever loaded inside a Codehouse window, not even in a frame.
//
// Built into Codehouse.exe. With /define:NAVGUARD_CLI it is a small program that apps/host/test/navguard-exe.test.ts
// runs, so the rules are tested as compiled.
using System;
using System.Text;

internal enum NavAction { Allow, External, Refuse }

internal static class NavGuard
{
    /// <summary>The same scheme, host and port, with no user name in the address. A prefix test let
    /// http://127.0.0.1:1234@elsewhere.example through, and :12345 after :1234.</summary>
    internal static bool SameOrigin(string uri, string origin)
    {
        if (uri == null || origin == null) return false;
        Uri u, o;
        if (!Uri.TryCreate(uri, UriKind.Absolute, out u) || !Uri.TryCreate(origin, UriKind.Absolute, out o)) return false;
        return u.UserInfo.Length == 0
            && string.Equals(u.Scheme, o.Scheme, StringComparison.OrdinalIgnoreCase)
            && string.Equals(u.Host, o.Host, StringComparison.OrdinalIgnoreCase)
            && u.Port == o.Port;
    }

    private static bool Inline(string uri)
    {
        return uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase) || uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>A page on this computer, shown in the Files pane's browser frame (a dev server you started).</summary>
    private static bool Loopback(string uri)
    {
        Uri u;
        if (!Uri.TryCreate(uri, UriKind.Absolute, out u) || u.UserInfo.Length > 0) return false;
        if (u.Scheme != "http" && u.Scheme != "https") return false;
        return u.Host == "127.0.0.1" || u.Host == "[::1]" || string.Equals(u.Host, "localhost", StringComparison.OrdinalIgnoreCase);
    }

    private static bool Web(string uri)
    {
        Uri u;
        return Uri.TryCreate(uri, UriKind.Absolute, out u) && (u.Scheme == "http" || u.Scheme == "https");
    }

    /// <summary>What to do with a navigation. <paramref name="where"/> is "window" (the page itself), "frame" (a
    /// frame inside it) or "new-window" (a link that opens a window). Allow means nothing is cancelled or reported.</summary>
    internal static NavAction Decide(string uri, string origin, string where)
    {
        if (string.IsNullOrEmpty(uri)) return NavAction.Refuse;
        if (SameOrigin(uri, origin)) return NavAction.Allow;
        if (where == "frame")
        {
            // A frame's address is chosen by the page, so it never opens anything outside: it is simply stopped.
            if (Inline(uri) || uri.StartsWith("blob:", StringComparison.OrdinalIgnoreCase) || Loopback(uri)) return NavAction.Allow;
            return NavAction.Refuse;
        }
        if (where == "window" && Inline(uri)) return NavAction.Allow;
        return Web(uri) ? NavAction.External : NavAction.Refuse;
    }

    /// <summary>What the audit records: the scheme and host only, never the path or query, which can carry names
    /// and tokens. Only plain address characters survive, so the result is safe inside JSON.</summary>
    internal static string Describe(string uri)
    {
        if (string.IsNullOrEmpty(uri)) return "";
        Uri u;
        string text;
        if (Uri.TryCreate(uri, UriKind.Absolute, out u) && u.Host.Length > 0) text = u.Scheme + "://" + u.Host + (u.IsDefaultPort ? "" : ":" + u.Port);
        else
        {
            int colon = uri.IndexOf(':');
            text = colon > 0 && colon <= 20 ? uri.Substring(0, colon + 1) : "";
        }
        StringBuilder sb = new StringBuilder();
        foreach (char c in text.ToLowerInvariant())
            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || ".-:/[]".IndexOf(c) >= 0) sb.Append(c);
        return sb.Length > 120 ? sb.ToString(0, 120) : sb.ToString();
    }

    /// <summary>The JSON the window sends to the Host's /api/shell/navigation.</summary>
    internal static string Report(string where, string uri, NavAction action)
    {
        return "{\"where\":\"" + where + "\",\"target\":\"" + Describe(uri) + "\",\"opened\":" + (action == NavAction.External ? "true" : "false") + "}";
    }

#if NAVGUARD_CLI
    private static int Main(string[] args)
    {
        // --decide <uri> <origin> <where>: prints allow, external or refuse, then the report line when not allow.
        if (args.Length == 4 && args[0] == "--decide")
        {
            NavAction a = Decide(args[1], args[2], args[3]);
            Console.WriteLine(a.ToString().ToLowerInvariant());
            if (a != NavAction.Allow) Console.WriteLine(Report(args[3], args[1], a));
            return 0;
        }
        Console.Error.WriteLine("usage: --decide <uri> <origin> <window|frame|new-window>");
        return 2;
    }
#endif
}
