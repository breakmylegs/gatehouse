// The quick prompt's shortcut (W1-15): the text you type in Settings, such as Ctrl+Alt+Space, read into what
// Windows' RegisterHotKey wants, and three free alternatives when another program already has it.
//
// Built into Codehouse.exe. With /define:HOTKEY_CLI it is also a small command for the tests:
//   Hotkey.exe --parse "Ctrl+Alt+Space"            {"ok":true,"text":"Ctrl+Alt+Space","mods":3,"vk":32}
//   Hotkey.exe --alternatives "Ctrl+Alt+Space" [--taken "A,B"]   three alternatives, one a line
//   Hotkey.exe --hold "Ctrl+Alt+Q"                 registers it and keeps it until its input closes
//   Hotkey.exe --try "Ctrl+Alt+Q"                  free, clash, or why the text is wrong
//
// Written in C# 5 so the compiler that ships with Windows can build it.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

internal static class Hotkey
{
    internal const uint ModAlt = 0x1, ModControl = 0x2, ModShift = 0x4, ModWin = 0x8, ModNoRepeat = 0x4000;
    internal const string Default = "Ctrl+Alt+Space";

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll")]
    internal static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    private static readonly Dictionary<string, uint> Named = new Dictionary<string, uint>(StringComparer.OrdinalIgnoreCase)
    {
        { "Space", 0x20 }, { "PageUp", 0x21 }, { "PageDown", 0x22 }, { "End", 0x23 }, { "Home", 0x24 },
        { "Insert", 0x2D }, { "Pause", 0x13 },
    };

    /// <summary>
    /// Reads a shortcut. It needs Ctrl, Alt or Win (Shift alone would type a letter) and one key: a letter, a
    /// digit, F1 to F24, Space, Insert, Home, End, Page Up, Page Down or Pause. False with a reason otherwise.
    /// </summary>
    internal static bool Parse(string text, out uint mods, out uint vk, out string error)
    {
        mods = 0;
        vk = 0;
        error = null;
        if (string.IsNullOrEmpty(text) || text.Trim().Length == 0) { error = "Type a shortcut, such as " + Default + "."; return false; }
        string[] parts = text.Split('+');
        foreach (string raw in parts)
        {
            string p = raw.Trim();
            uint m = Modifier(p);
            if (m != 0)
            {
                if ((mods & m) != 0) { error = p + " is there twice."; return false; }
                mods |= m;
                continue;
            }
            uint k = Key(p);
            if (k == 0) { error = (p.Length == 0 ? "A part is empty" : p + " is not a key Codehouse can use") + ". Use a letter, a digit, F1 to F24, Space, Insert, Home, End, PageUp, PageDown or Pause."; return false; }
            if (vk != 0) { error = "Use one key with Ctrl, Alt, Shift or Win."; return false; }
            vk = k;
        }
        if (vk == 0) { error = "Add a key, such as Space or a letter."; return false; }
        if ((mods & (ModControl | ModAlt | ModWin)) == 0) { error = "Add Ctrl, Alt or Win, so the shortcut does not type in other programs."; return false; }
        return true;
    }

    private static uint Modifier(string p)
    {
        switch (p.ToLowerInvariant())
        {
            case "ctrl": case "control": return ModControl;
            case "alt": return ModAlt;
            case "shift": return ModShift;
            case "win": case "windows": return ModWin;
            default: return 0;
        }
    }

    private static uint Key(string p)
    {
        uint v;
        if (Named.TryGetValue(p, out v)) return v;
        if (p.Length == 1)
        {
            char c = char.ToUpperInvariant(p[0]);
            if (c >= 'A' && c <= 'Z') return c;
            if (c >= '0' && c <= '9') return c;
            return 0;
        }
        int n;
        if ((p[0] == 'F' || p[0] == 'f') && int.TryParse(p.Substring(1), out n) && n >= 1 && n <= 24 && p.Substring(1) == n.ToString())
            return (uint)(0x70 + n - 1);
        return 0;
    }

    /// <summary>The shortcut written the one way: Ctrl, Alt, Shift, Win, then the key.</summary>
    internal static string Format(uint mods, uint vk)
    {
        List<string> parts = new List<string>();
        if ((mods & ModControl) != 0) parts.Add("Ctrl");
        if ((mods & ModAlt) != 0) parts.Add("Alt");
        if ((mods & ModShift) != 0) parts.Add("Shift");
        if ((mods & ModWin) != 0) parts.Add("Win");
        string key = null;
        foreach (KeyValuePair<string, uint> kv in Named) if (kv.Value == vk) key = kv.Key;
        if (key == null && vk >= 0x70 && vk <= 0x87) key = "F" + (vk - 0x70 + 1);
        if (key == null) key = ((char)vk).ToString();
        parts.Add(key);
        return string.Join("+", parts.ToArray());
    }

    /// <summary>
    /// Three shortcuts near the one asked for that are free (isFree says so), for when another program has it: the
    /// same key with other modifiers first, then the same modifiers with other keys.
    /// </summary>
    internal static string[] Alternatives(string text, Func<uint, uint, bool> isFree)
    {
        uint mods, vk;
        string error;
        if (!Parse(text, out mods, out vk, out error)) Parse(Default, out mods, out vk, out error);
        uint[] modSets = new uint[]
        {
            mods | ModShift, ModControl | ModShift, ModAlt | ModShift, ModControl | ModWin, ModControl | ModAlt,
            ModControl | ModAlt | ModShift,
        };
        uint[] keys = new uint[] { 0x20, 'J', 'K', 'Q', 'G', 0x7B };
        List<string> out3 = new List<string>();
        List<KeyValuePair<uint, uint>> tried = new List<KeyValuePair<uint, uint>>();
        tried.Add(new KeyValuePair<uint, uint>(mods, vk));
        Action<uint, uint> consider = delegate(uint m, uint k)
        {
            if (out3.Count >= 3) return;
            KeyValuePair<uint, uint> pair = new KeyValuePair<uint, uint>(m, k);
            if (tried.Contains(pair)) return;
            tried.Add(pair);
            if (isFree(m, k)) out3.Add(Format(m, k));
        };
        foreach (uint m in modSets) consider(m, vk);
        foreach (uint k in keys) consider(mods, k);
        foreach (uint m in modSets) foreach (uint k in keys) consider(m, k);
        return out3.ToArray();
    }

    /// <summary>Whether Windows would give this process the shortcut now: registered, then let go at once.</summary>
    internal static bool IsFree(uint mods, uint vk)
    {
        const int probe = 0xBFF0;
        if (!RegisterHotKey(IntPtr.Zero, probe, mods | ModNoRepeat, vk)) return false;
        UnregisterHotKey(IntPtr.Zero, probe);
        return true;
    }
}

#if HOTKEY_CLI
internal static class HotkeyCli
{
    private static string Json(string s) { return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }

    private static int Main(string[] args)
    {
        if (args.Length < 2) { Console.WriteLine("Usage: Hotkey.exe --parse|--alternatives|--hold|--try <shortcut>"); return 2; }
        uint mods, vk;
        string error;
        bool ok = Hotkey.Parse(args[1], out mods, out vk, out error);
        switch (args[0])
        {
            case "--parse":
                Console.WriteLine(ok
                    ? "{\"ok\":true,\"text\":" + Json(Hotkey.Format(mods, vk)) + ",\"mods\":" + mods + ",\"vk\":" + vk + "}"
                    : "{\"ok\":false,\"error\":" + Json(error) + "}");
                return 0;
            case "--alternatives":
            {
                List<string> taken = new List<string>();
                if (args.Length > 3 && args[2] == "--taken") taken.AddRange(args[3].Split(','));
                foreach (string a in Hotkey.Alternatives(args[1], delegate(uint m, uint k) { return !taken.Contains(Hotkey.Format(m, k)); }))
                    Console.WriteLine(a);
                return 0;
            }
            case "--hold":
                if (!ok || !Hotkey.RegisterHotKey(IntPtr.Zero, 1, mods | Hotkey.ModNoRepeat, vk)) { Console.WriteLine("clash"); return 1; }
                Console.WriteLine("held");
                Console.In.ReadToEnd();
                Hotkey.UnregisterHotKey(IntPtr.Zero, 1);
                return 0;
            case "--try":
                Console.WriteLine(!ok ? "bad: " + error : Hotkey.IsFree(mods, vk) ? "free" : "clash");
                return 0;
            default:
                return 2;
        }
    }
}
#endif
