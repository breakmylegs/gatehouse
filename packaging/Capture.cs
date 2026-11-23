using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// CH-08 (owner's Chat build): a picture of part of the screen, or of the window you were in, taken from the quick
// prompt and attached to the chat as a picture. Pictures are not redacted, which the quick prompt says; the Host
// audits each one when it is attached. Nothing is kept here: the picture goes back to the page as PNG bytes.
internal static class ScreenCapture
{
    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    /// <summary>The most a capture may be, as the attach route allows (20 MB of PNG is a very large screen).</summary>
    internal const int MaxBytes = 20 * 1024 * 1024;

    /// <summary>The whole desktop as it looks now, over every monitor.</summary>
    private static Bitmap Desktop(out Rectangle bounds)
    {
        bounds = SystemInformation.VirtualScreen;
        Bitmap shot = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(shot)) g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
        return shot;
    }

    private static byte[] Png(Bitmap bmp)
    {
        using (MemoryStream ms = new MemoryStream())
        {
            bmp.Save(ms, ImageFormat.Png);
            return ms.Length > MaxBytes ? null : ms.ToArray();
        }
    }

    /// <summary>The window you were in before the quick prompt opened, as it looks on screen. Null if it is gone.</summary>
    internal static byte[] Window(IntPtr hWnd)
    {
        RECT r;
        if (hWnd == IntPtr.Zero || !IsWindow(hWnd) || !GetWindowRect(hWnd, out r)) return null;
        Rectangle rect = Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
        rect.Intersect(SystemInformation.VirtualScreen);
        if (rect.Width < 2 || rect.Height < 2) return null;
        using (Bitmap bmp = new Bitmap(rect.Width, rect.Height, PixelFormat.Format32bppArgb))
        {
            using (Graphics g = Graphics.FromImage(bmp)) g.CopyFromScreen(rect.Location, Point.Empty, rect.Size);
            return Png(bmp);
        }
    }

    /// <summary>A part of the screen you drag out. The screen is frozen as a picture while you do; Esc cancels.</summary>
    internal static byte[] Region()
    {
        Rectangle bounds;
        using (Bitmap desk = Desktop(out bounds))
        using (RegionForm f = new RegionForm(desk, bounds))
        {
            if (f.ShowDialog() != DialogResult.OK) return null;
            Rectangle chosen = f.Chosen;
            if (chosen.Width < 2 || chosen.Height < 2) return null;
            using (Bitmap crop = desk.Clone(chosen, desk.PixelFormat)) return Png(crop);
        }
    }

    private sealed class RegionForm : Form
    {
        private readonly Bitmap desk;
        private Point start;
        private bool dragging;
        internal Rectangle Chosen;

        internal RegionForm(Bitmap desk, Rectangle bounds)
        {
            this.desk = desk;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Bounds = bounds;
            TopMost = true;
            ShowInTaskbar = false;
            Cursor = Cursors.Cross;
            DoubleBuffered = true;
            KeyPreview = true;
            Text = "Drag over the part of the screen to attach. Esc cancels.";
            KeyDown += delegate(object s, KeyEventArgs e) { if (e.KeyCode == Keys.Escape) { DialogResult = DialogResult.Cancel; Close(); } };
            MouseDown += delegate(object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) { dragging = true; start = e.Location; Chosen = Rectangle.Empty; } };
            MouseMove += delegate(object s, MouseEventArgs e) { if (dragging) { Chosen = Box(start, e.Location); Invalidate(); } };
            MouseUp += delegate(object s, MouseEventArgs e)
            {
                if (!dragging) return;
                dragging = false;
                Chosen = Box(start, e.Location);
                DialogResult = DialogResult.OK;
                Close();
            };
        }

        private static Rectangle Box(Point a, Point b)
        {
            return Rectangle.FromLTRB(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), Math.Max(a.X, b.X), Math.Max(a.Y, b.Y));
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.DrawImage(desk, Point.Empty);
            using (SolidBrush dim = new SolidBrush(Color.FromArgb(110, 0, 0, 0)))
            {
                Region outside = new Region(ClientRectangle);
                if (Chosen.Width > 0) outside.Exclude(Chosen);
                e.Graphics.FillRegion(dim, outside);
                outside.Dispose();
            }
            if (Chosen.Width > 0)
                using (Pen p = new Pen(Color.White, 2)) e.Graphics.DrawRectangle(p, Chosen);
            using (Font font = new Font("Segoe UI", 11f))
                e.Graphics.DrawString(Text, font, Brushes.White, 16, 16);
        }
    }
}

// E-091, screen-share safe mode: a window kept out of screen captures and screen sharing (Windows 10 2004 and later),
// so what it shows stays off a shared screen. Set on the quick prompt and the pop-out windows while the mode is on.
internal static class CaptureGuard
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint affinity);

    [DllImport("user32.dll")]
    private static extern bool GetWindowDisplayAffinity(IntPtr hWnd, out uint affinity);

    public const uint WDA_NONE = 0;
    public const uint WDA_EXCLUDEFROMCAPTURE = 0x11;

    /** Keeps the window out of captures, or lets it be captured again. False when Windows refused. */
    public static bool Exclude(IntPtr hWnd, bool on)
    {
        return hWnd != IntPtr.Zero && SetWindowDisplayAffinity(hWnd, on ? WDA_EXCLUDEFROMCAPTURE : WDA_NONE);
    }

    /** The window's display affinity as Windows has it now. */
    public static uint Affinity(IntPtr hWnd)
    {
        uint a;
        return GetWindowDisplayAffinity(hWnd, out a) ? a : uint.MaxValue;
    }
}

#if CAPTUREGUARD_CLI
// For the test: a real window, excluded and then let go, its affinity read back from Windows each time.
internal static class CaptureGuardCli
{
    [STAThread]
    private static void Main()
    {
        using (Form f = new Form())
        {
            f.ShowInTaskbar = false;
            f.StartPosition = FormStartPosition.Manual;
            f.Location = new Point(-2000, -2000);
            f.Size = new Size(120, 80);
            f.Show();
            bool set = CaptureGuard.Exclude(f.Handle, true);
            uint on = CaptureGuard.Affinity(f.Handle);
            CaptureGuard.Exclude(f.Handle, false);
            uint off = CaptureGuard.Affinity(f.Handle);
            Console.WriteLine((set ? "set" : "refused") + " " + on.ToString("x") + " " + off.ToString("x"));
        }
    }
}
#endif
