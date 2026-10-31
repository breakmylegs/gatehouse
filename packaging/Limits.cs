using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

// JCVC-Limits.exe: runs Claude Code for one session inside a Windows job object that caps what it, and everything it
// starts, may use: a share of the processor, memory and a lower priority (owner, 30 Oct: Low, Medium and High per
// session).
//
//   JCVC-Limits.exe --name <job> --cpu <percent> --memory-mb <MB> --priority <below|normal> -- <command line>
//       Starts the command suspended inside a new job with those limits, hands it this program's own input, output
//       and error streams, lets it run and exits with its exit code. Closing this program (or killing it) closes the
//       job, which ends the command and everything it started. 0 for --cpu or --memory-mb means no limit.
//   JCVC-Limits.exe --set <job> --cpu <percent> --memory-mb <MB> --priority <below|normal>
//       Changes the limits of a running job.
//   JCVC-Limits.exe --query <job>
//       Prints the job's limits and how many processes it has, as JSON.
//
// The command line after the first " -- " is passed on exactly as it arrived, so nothing is quoted twice.
static class Limits
{
    const uint KILL_ON_JOB_CLOSE = 0x2000, JOB_MEMORY = 0x200, PRIORITY_CLASS = 0x20;
    const uint NORMAL = 0x20, BELOW_NORMAL = 0x4000;
    const uint CREATE_SUSPENDED = 0x4, CREATE_NO_WINDOW = 0x08000000, CREATE_UNICODE_ENVIRONMENT = 0x400;
    const int STARTF_USESTDHANDLES = 0x100;
    const uint JOB_ALL_ACCESS = 0x1F001F;
    const int ExtendedLimits = 9, CpuRate = 15, BasicAccounting = 1;

    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimit
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimit
    {
        public BasicLimit Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct CpuRateControl
    {
        public uint ControlFlags, CpuRate;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct Accounting
    {
        public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct StartupInfo
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObjectW(IntPtr attrs, string name);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr OpenJobObjectW(uint access, bool inherit, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags,
        IntPtr env, string cwd, ref StartupInfo si, out ProcessInfo pi);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr GetCommandLineW();
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int which);

    static void Say(string line)
    {
        Console.Error.WriteLine("[jcvc-limits] " + line);
    }

    static string Arg(string[] args, string key)
    {
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "--") break;
            if (args[i] == key) return args[i + 1];
        }
        return null;
    }

    static uint Number(string v, uint max)
    {
        uint n;
        if (v == null || !uint.TryParse(v, out n)) return 0;
        return n > max ? max : n;
    }

    static bool Set<T>(IntPtr job, int infoClass, T value)
    {
        int size = Marshal.SizeOf(typeof(T));
        IntPtr p = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(value, p, false);
            return SetInformationJobObject(job, infoClass, p, (uint)size);
        }
        finally { Marshal.FreeHGlobal(p); }
    }

    static T Get<T>(IntPtr job, int infoClass) where T : struct
    {
        int size = Marshal.SizeOf(typeof(T));
        IntPtr p = Marshal.AllocHGlobal(size);
        try
        {
            if (!QueryInformationJobObject(job, infoClass, p, (uint)size, IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            return (T)Marshal.PtrToStructure(p, typeof(T));
        }
        finally { Marshal.FreeHGlobal(p); }
    }

    /** The limits from the arguments. Every job keeps kill-on-close, so closing this program ends what it started. */
    static void Apply(IntPtr job, string[] args)
    {
        uint cpu = Number(Arg(args, "--cpu"), 100);
        uint mb = Number(Arg(args, "--memory-mb"), 1024 * 1024);
        bool below = Arg(args, "--priority") == "below";
        ExtendedLimit ext = new ExtendedLimit();
        ext.Basic.LimitFlags = KILL_ON_JOB_CLOSE | PRIORITY_CLASS | (mb > 0 ? JOB_MEMORY : 0);
        ext.Basic.PriorityClass = below ? BELOW_NORMAL : NORMAL;
        ext.JobMemoryLimit = new UIntPtr((ulong)mb * 1024 * 1024);
        if (!Set(job, ExtendedLimits, ext)) throw new Win32Exception(Marshal.GetLastWin32Error());
        CpuRateControl rate = new CpuRateControl();
        // JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | HARD_CAP, in hundredths of a percent. Windows refuses a rate with no
        // flags, so no limit is a cap at the whole processor.
        rate.ControlFlags = 0x1 | 0x4;
        rate.CpuRate = (cpu > 0 && cpu < 100 ? cpu : 100) * 100;
        if (!Set(job, CpuRate, rate)) Say("the processor cap could not be set: " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
    }

    static int Run(string[] args)
    {
        string name = Arg(args, "--name");
        string raw = Marshal.PtrToStringUni(GetCommandLineW());
        int at = raw.IndexOf(" -- ", StringComparison.Ordinal);
        if (name == null || at < 0 || at + 4 >= raw.Length) { Say("usage: --name <job> [limits] -- <command line>"); return 2; }
        string command = raw.Substring(at + 4);

        IntPtr job = CreateJobObjectW(IntPtr.Zero, name);
        if (job == IntPtr.Zero) { Say("no job object: " + new Win32Exception(Marshal.GetLastWin32Error()).Message); return 3; }
        Apply(job, args);

        StartupInfo si = new StartupInfo();
        si.cb = Marshal.SizeOf(typeof(StartupInfo));
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdInput = GetStdHandle(-10);
        si.hStdOutput = GetStdHandle(-11);
        si.hStdError = GetStdHandle(-12);
        ProcessInfo pi;
        if (!CreateProcessW(null, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true,
                CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, IntPtr.Zero, null, ref si, out pi))
        {
            Say("could not start it: " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
            return 4;
        }
        // In the job before it runs a single instruction, so nothing it starts escapes the limits.
        if (!AssignProcessToJobObject(job, pi.hProcess))
        {
            Say("could not put it in the job, so it was not started: " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
            TerminateProcess(pi.hProcess, 5);
            return 5;
        }
        ResumeThread(pi.hThread);
        CloseHandle(pi.hThread);
        WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
        uint code;
        GetExitCodeProcess(pi.hProcess, out code);
        CloseHandle(pi.hProcess);
        // Closing the job ends anything it left running.
        CloseHandle(job);
        return (int)code;
    }

    static int Main(string[] args)
    {
        try
        {
            string set = Arg(args, "--set"), query = Arg(args, "--query");
            if (set != null || query != null)
            {
                IntPtr job = OpenJobObjectW(JOB_ALL_ACCESS, false, set ?? query);
                if (job == IntPtr.Zero) { Say("no such job"); return 2; }
                try
                {
                    if (set != null) { Apply(job, args); return 0; }
                    ExtendedLimit ext = Get<ExtendedLimit>(job, ExtendedLimits);
                    CpuRateControl rate = Get<CpuRateControl>(job, CpuRate);
                    Accounting acc = Get<Accounting>(job, BasicAccounting);
                    bool hasMem = (ext.Basic.LimitFlags & JOB_MEMORY) != 0;
                    uint percent = (rate.ControlFlags & 0x1) != 0 ? rate.CpuRate / 100 : 0;
                    Console.Out.WriteLine("{\"cpu\":" + (percent >= 100 ? 0 : percent)
                        + ",\"memoryMb\":" + (hasMem ? ext.JobMemoryLimit.ToUInt64() / (1024 * 1024) : 0)
                        + ",\"priority\":\"" + (ext.Basic.PriorityClass == BELOW_NORMAL ? "below" : "normal") + "\""
                        + ",\"processes\":" + acc.ActiveProcesses + "}");
                    return 0;
                }
                finally { CloseHandle(job); }
            }
            return Run(args);
        }
        catch (Exception e)
        {
            Say(e.Message);
            return 6;
        }
    }
}
