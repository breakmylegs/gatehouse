// The window's backdrop (backlog U16): Windows 11's Mica material behind the title bar, where Windows can draw it, and
// the plain opaque window everywhere else. C# 5, built with the compiler that ships with Windows.
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class Backdrop
{
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    private const int SystemBackdropType = 38; // DWMWA_SYSTEMBACKDROP_TYPE, Windows 11 22H2 and later
    private const int MainWindowBackdrop = 2;  // DWMSBT_MAINWINDOW: Mica

    /// <summary>
    /// Mica only on Windows 11 22H2 (build 22621) or later, with transparency effects on and high contrast off; with
    /// any of those not so, the window stays opaque, as before, which is also what an older Windows draws.
    /// </summary>
    internal static bool Wanted(int build, bool highContrast, bool transparencyOn)
    {
        return build >= 22621 && !highContrast && transparencyOn;
    }

    internal static void Apply(IntPtr hwnd)
    {
        try
        {
            if (!Wanted(Environment.OSVersion.Version.Build, SystemInformation.HighContrast, TransparencyOn())) return;
            int value = MainWindowBackdrop;
            DwmSetWindowAttribute(hwnd, SystemBackdropType, ref value, sizeof(int));
        }
        catch (Exception)
        {
            // An older Windows, or no DWM: the window stays as it was.
        }
    }

    /// <summary>Settings, Personalisation, Colours, Transparency effects. Unreadable counts as off.</summary>
    private static bool TransparencyOn()
    {
        try
        {
            using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
            {
                object v = key == null ? null : key.GetValue("EnableTransparency");
                return v is int ? (int)v != 0 : true;
            }
        }
        catch (Exception)
        {
            return false;
        }
    }

#if BACKDROP_CLI
    // For the test: Backdrop.exe <build> <highContrast 0|1> <transparency 0|1> prints mica or opaque.
    private static void Main(string[] args)
    {
        bool mica = Wanted(int.Parse(args[0]), args[1] == "1", args[2] == "1");
        Console.WriteLine(mica ? "mica" : "opaque");
    }
#endif
}
