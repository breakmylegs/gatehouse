using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

// Codehouse-Helper.exe: what Codehouse itself needs from Windows, without PowerShell (owner, 4 Nov: "Why do I need
// powershell at all?"). Built from this file with the C# compiler that ships with Windows, like Codehouse-Limits.exe.
//
//   Codehouse-Helper.exe --protect      base64 in on stdin, DPAPI-sealed for this Windows user, base64 out on stdout
//   Codehouse-Helper.exe --unprotect    the other way
//   Codehouse-Helper.exe --pick-folder  the normal "choose a folder" window; the folder chosen on stdout, nothing if
//                                       cancelled. The starting folder comes in CODEHOUSE_PICK_START.
//   Codehouse-Helper.exe --save-as      the normal save window; the file chosen on stdout. The suggested name comes in
//                                       CODEHOUSE_SAVE_NAME.
//
// Names and folders travel in environment variables, never on the command line, so none can become an argument.
// Output is UTF-8 without a byte order mark. Exit code 0 is success (a cancelled window too), 1 a failure, 2 misuse.
static class Helper
{
    [STAThread]
    static int Main(string[] args)
    {
        // A window program has no console to set an encoding on, so it writes UTF-8 to its output stream itself.
        StreamWriter output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        output.AutoFlush = true;
        Console.SetOut(output);
        StreamWriter errors = new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false));
        errors.AutoFlush = true;
        Console.SetError(errors);
        if (args.Length != 1) return Usage();
        try
        {
            switch (args[0])
            {
                case "--protect": return Seal(true);
                case "--unprotect": return Seal(false);
                case "--pick-folder": return PickFolder();
                case "--save-as": return SaveAs();
                default: return Usage();
            }
        }
        catch (Exception e)
        {
            Console.Error.WriteLine(e.GetType().Name + ": " + e.Message);
            return 1;
        }
    }

    static int Usage()
    {
        Console.Error.WriteLine("usage: Codehouse-Helper.exe --protect | --unprotect | --pick-folder | --save-as");
        return 2;
    }

    static int Seal(bool protect)
    {
        byte[] bytes = Convert.FromBase64String(Console.In.ReadToEnd().Trim());
        byte[] result = protect
            ? ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser)
            : ProtectedData.Unprotect(bytes, null, DataProtectionScope.CurrentUser);
        Console.Out.Write(Convert.ToBase64String(result));
        return 0;
    }

    /// <summary>A tiny window off screen to own the dialog, so it comes to the front over Codehouse.</summary>
    static Form Owner()
    {
        Form f = new Form();
        f.TopMost = true;
        f.ShowInTaskbar = false;
        f.StartPosition = FormStartPosition.Manual;
        f.Location = new System.Drawing.Point(-2000, -2000);
        f.Size = new System.Drawing.Size(1, 1);
        f.Show();
        return f;
    }

    static int PickFolder()
    {
        using (Form owner = Owner())
        using (FolderBrowserDialog d = new FolderBrowserDialog())
        {
            d.Description = "Choose the project folder";
            d.ShowNewFolderButton = true;
            string start = Environment.GetEnvironmentVariable("CODEHOUSE_PICK_START");
            if (!string.IsNullOrEmpty(start) && Directory.Exists(start)) d.SelectedPath = start;
            if (d.ShowDialog(owner) == DialogResult.OK) Console.Out.Write(d.SelectedPath);
        }
        return 0;
    }

    static int SaveAs()
    {
        using (Form owner = Owner())
        using (SaveFileDialog d = new SaveFileDialog())
        {
            d.Title = "Save a copy";
            d.OverwritePrompt = true;
            d.FileName = Environment.GetEnvironmentVariable("CODEHOUSE_SAVE_NAME") ?? "";
            if (d.ShowDialog(owner) == DialogResult.OK) Console.Out.Write(d.FileName);
        }
        return 0;
    }
}
