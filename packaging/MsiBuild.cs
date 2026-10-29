// MsiBuild.exe: makes JCVC-Setup.msi with Windows Installer's own library (msi.dll), so no outside tool is needed.
// scripts/msi.mjs writes the tables as .idt text files, the cabinet with makecab, and a few side files; this
// program puts them together:
//
//   MsiBuild.exe <out.msi> <folder>
//     <folder>\*.idt        tables, imported in name order (_ForceCodepage.idt first)
//     <folder>\streams.txt  table <TAB> name <TAB> file: binary rows (the cabinet, the icon)
//     <folder>\summary.txt  pid <TAB> value: the summary information (title, template, package code...)
//
// Written in C# 5 so the compiler that ships with Windows can build it.

using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

internal static class MsiBuild
{
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiOpenDatabase(string path, IntPtr persist, out IntPtr db);
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiDatabaseImport(IntPtr db, string folder, string file);
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiDatabaseOpenView(IntPtr db, string query, out IntPtr view);
    [DllImport("msi.dll")] private static extern uint MsiViewExecute(IntPtr view, IntPtr record);
    [DllImport("msi.dll")] private static extern uint MsiViewClose(IntPtr view);
    [DllImport("msi.dll")] private static extern IntPtr MsiCreateRecord(uint fields);
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiRecordSetString(IntPtr record, uint field, string value);
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiRecordSetStream(IntPtr record, uint field, string file);
    [DllImport("msi.dll")] private static extern uint MsiDatabaseCommit(IntPtr db);
    [DllImport("msi.dll")] private static extern uint MsiCloseHandle(IntPtr handle);
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiGetSummaryInformation(IntPtr db, string path, uint updates, out IntPtr summary);
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiSummaryInfoSetProperty(IntPtr summary, uint pid, uint type, int value, ref long time, string text);
    [DllImport("msi.dll")] private static extern uint MsiSummaryInfoPersist(IntPtr summary);
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiGetLastErrorRecord();
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiFormatRecord(IntPtr install, IntPtr record, System.Text.StringBuilder result, ref uint size);

    private const uint VT_I2 = 2, VT_I4 = 3, VT_LPSTR = 30, VT_FILETIME = 64;

    private static void Check(uint code, string what)
    {
        if (code != 0) throw new InvalidOperationException(what + " failed with Windows Installer error " + code + ".");
    }

    private static int Main(string[] args)
    {
        if (args.Length != 2)
        {
            Console.Error.WriteLine("Usage: MsiBuild.exe <out.msi> <folder with .idt files, streams.txt and summary.txt>");
            return 2;
        }
        string output = Path.GetFullPath(args[0]);
        string folder = Path.GetFullPath(args[1]);
        IntPtr db = IntPtr.Zero;
        try
        {
            if (File.Exists(output)) File.Delete(output);
            Check(MsiOpenDatabase(output, (IntPtr)3 /* MSIDBOPEN_CREATE */, out db), "Creating " + output);

            // The code page first, so every table after it is read in it.
            List<string> tables = new List<string>(Directory.GetFiles(folder, "*.idt"));
            tables.Sort(delegate(string a, string b)
            {
                bool ca = Path.GetFileName(a) == "_ForceCodepage.idt", cb = Path.GetFileName(b) == "_ForceCodepage.idt";
                if (ca != cb) return ca ? -1 : 1;
                return string.CompareOrdinal(a, b);
            });
            foreach (string t in tables)
                Check(MsiDatabaseImport(db, folder, Path.GetFileName(t)), "Importing " + Path.GetFileName(t));

            // Binary rows: the embedded cabinet goes in _Streams, the icon in the Icon table.
            string streams = Path.Combine(folder, "streams.txt");
            if (File.Exists(streams))
                foreach (string line in File.ReadAllLines(streams))
                {
                    string[] p = line.Split('\t');
                    if (p.Length != 3) continue;
                    string sql = p[0] == "_Streams"
                        ? "INSERT INTO `_Streams` (`Name`, `Data`) VALUES (?, ?)"
                        : "INSERT INTO `" + p[0] + "` (`Name`, `Data`) VALUES (?, ?)";
                    IntPtr view;
                    Check(MsiDatabaseOpenView(db, sql, out view), "Preparing " + p[0]);
                    IntPtr rec = MsiCreateRecord(2);
                    Check(MsiRecordSetString(rec, 1, p[1]), "Naming " + p[1]);
                    Check(MsiRecordSetStream(rec, 2, Path.Combine(folder, p[2])), "Reading " + p[2]);
                    Check(MsiViewExecute(view, rec), "Adding " + p[1] + " to " + p[0]);
                    MsiCloseHandle(rec);
                    MsiViewClose(view);
                    MsiCloseHandle(view);
                }

            // Summary information: title, template, package code, schema, word count and so on.
            IntPtr si;
            Check(MsiGetSummaryInformation(db, null, 20, out si), "Opening the summary information");
            long now = DateTime.Now.ToFileTime();
            foreach (string line in File.ReadAllLines(Path.Combine(folder, "summary.txt")))
            {
                string[] p = line.Split(new char[] { '\t' }, 2);
                if (p.Length != 2) continue;
                uint pid = uint.Parse(p[0]);
                if (pid == 12 || pid == 13)
                    Check(MsiSummaryInfoSetProperty(si, pid, VT_FILETIME, 0, ref now, null), "Setting a date");
                else if (pid == 1)
                    Check(MsiSummaryInfoSetProperty(si, pid, VT_I2, int.Parse(p[1]), ref now, null), "Setting the code page");
                else if (pid == 14 || pid == 15 || pid == 19)
                    Check(MsiSummaryInfoSetProperty(si, pid, VT_I4, int.Parse(p[1]), ref now, null), "Setting summary " + pid);
                else
                    Check(MsiSummaryInfoSetProperty(si, pid, VT_LPSTR, 0, ref now, p[1]), "Setting summary " + pid);
            }
            Check(MsiSummaryInfoPersist(si), "Saving the summary information");
            MsiCloseHandle(si);

            Check(MsiDatabaseCommit(db), "Saving " + output);
            Console.WriteLine("[msi] wrote " + output);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("[msi] " + ex.Message);
            return 1;
        }
        finally
        {
            if (db != IntPtr.Zero) MsiCloseHandle(db);
        }
    }
}
