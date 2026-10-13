using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace QLBS.Kiosk
{
    static class Program
    {
        private static Mutex singleMutex;
        private static string serverUrl = "http://localhost:3000";
        private static string roomCode = "PK01";
        private static string terminalId = "term_PK01_default";
        private static string edgeProfileDir = @"C:\QLBS_Kiosk\EdgeProfile";
        private static string configFile = @"C:\QLBS_Kiosk\config.ini";

        private static volatile bool isLocked = true;
        private static volatile bool isAppRunning = true;
        private static DateTime lastLaunchTime = DateTime.MinValue;

        // Windows API Hooks
        private static IntPtr hookId = IntPtr.Zero;
        private static LowLevelKeyboardProc hookProc = HookCallback;

        [STAThread]
        static void Main(string[] args)
        {
            // 1. Chống chạy đa tiến trình (Single Instance Mutex)
            bool createdNew;
            singleMutex = new Mutex(true, "QLBS_Kiosk_Agent_Mutex_Bvqy4", out createdNew);
            if (!createdNew)
            {
                return; // Đã có Agent đang chạy bảo vệ hệ thống
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // Bỏ qua kiểm tra chứng chỉ SSL tự ký khi kết nối HTTPS nội bộ
            ServicePointManager.ServerCertificateValidationCallback = delegate { return true; };
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls;
            }
            catch {}

            // 2. Nạp cấu hình từ tệp config.ini
            LoadConfig();

            // 3. Cài đặt Hook bàn phím cấp độ nhân (Chặn Win, Alt+Tab, Taskmgr...)
            hookId = SetHook(hookProc);

            // 4. Khởi động Edge Kiosk lần đầu tiên
            LaunchEdgeKiosk();

            // 5. Khởi động luồng nền giám sát trạng thái từ máy chủ
            Thread monitorThread = new Thread(BackgroundMonitorLoop)
            {
                IsBackground = true,
                Name = "KioskStateMonitor"
            };
            monitorThread.Start();

            // 6. Chạy vòng lặp thông điệp Windows để duy trì hook
            Application.Run();

            // Dọn dẹp khi tắt
            CleanupAndExit();
        }

        private static void LoadConfig()
        {
            try
            {
                if (File.Exists(configFile))
                {
                    string[] lines = File.ReadAllLines(configFile);
                    foreach (string line in lines)
                    {
                        string trimmed = line.Trim();
                        if (trimmed.StartsWith("#") || !trimmed.Contains("=")) continue;
                        int idx = trimmed.IndexOf('=');
                        string key = trimmed.Substring(0, idx).Trim().ToLowerInvariant();
                        string val = trimmed.Substring(idx + 1).Trim();

                        if (key == "serverurl") serverUrl = val.TrimEnd('/');
                        else if (key == "roomcode") roomCode = val.ToUpperInvariant();
                        else if (key == "terminalid") terminalId = val;
                        else if (key == "edgeprofiledir") edgeProfileDir = val;
                    }
                }
            }
            catch {}
        }

        // ====================================================================
        // QUẢN LÝ TIẾN TRÌNH TRÌNH DUYỆT (CHỐNG NHÁY MÀN HÌNH / INFINITE LOOP)
        // ====================================================================

        private static bool IsKioskBrowserRunning()
        {
            try
            {
                Process[] msedge = Process.GetProcessesByName("msedge");
                if (msedge.Length > 0) return true;

                Process[] chrome = Process.GetProcessesByName("chrome");
                if (chrome.Length > 0) return true;
            }
            catch {}
            return false;
        }

        private static void LaunchEdgeKiosk()
        {
            try
            {
                // Cooldown 5 giây: Tuyệt đối không gọi mở liên tiếp tránh nhấp nháy màn hình
                TimeSpan diff = DateTime.UtcNow - lastLaunchTime;
                if (diff.TotalSeconds < 5)
                {
                    return;
                }
                lastLaunchTime = DateTime.UtcNow;

                // Nếu trình duyệt đã đang mở thì giữ nguyên, KHÔNG tắt và KHÔNG mở thêm
                if (IsKioskBrowserRunning())
                {
                    return;
                }

                string browserPath = FindBrowserExecutable();
                if (string.IsNullOrEmpty(browserPath)) return;

                if (!Directory.Exists(edgeProfileDir))
                {
                    Directory.CreateDirectory(edgeProfileDir);
                }

                string targetUrl = string.Format("{0}/kiosk/{1}?terminalId={2}", serverUrl, roomCode, terminalId);
                string arguments = string.Format(
                    "--kiosk \"{0}\" --edge-kiosk-type=fullscreen --no-first-run --no-default-browser-check --disable-translate --disable-features=Translate,OptimizationHints --ignore-certificate-errors --user-data-dir=\"{1}\"",
                    targetUrl,
                    edgeProfileDir
                );

                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = browserPath,
                    Arguments = arguments,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Maximized
                };

                Process.Start(psi);
            }
            catch {}
        }

        private static string FindBrowserExecutable()
        {
            string[] candidates = new string[]
            {
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
            };

            foreach (string p in candidates)
            {
                if (File.Exists(p)) return p;
            }
            return null;
        }

        private static void KillKioskProcesses()
        {
            try
            {
                // Cưỡng chế tắt toàn bộ cây tiến trình msedge Kiosk bằng taskkill để giải phóng Desktop ngay
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = "taskkill.exe",
                    Arguments = "/F /T /IM msedge.exe",
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                using (Process p = Process.Start(psi))
                {
                    p.WaitForExit(1000);
                }
            }
            catch {}

            try
            {
                ProcessStartInfo psiChrome = new ProcessStartInfo
                {
                    FileName = "taskkill.exe",
                    Arguments = "/F /T /IM chrome.exe",
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                using (Process p = Process.Start(psiChrome))
                {
                    p.WaitForExit(1000);
                }
            }
            catch {}

            try
            {
                Process[] procs = Process.GetProcessesByName("msedge");
                foreach (Process p in procs)
                {
                    try { p.Kill(); } catch {}
                }
            }
            catch {}

            try
            {
                Process[] procs = Process.GetProcessesByName("chrome");
                foreach (Process p in procs)
                {
                    try { p.Kill(); } catch {}
                }
            }
            catch {}
        }

        // ====================================================================
        // VÒNG LẶP THEO DÕI TRẠNG THÁI MỞ KHOÁ TỪ MÁY CHỦ
        // ====================================================================

        private static void BackgroundMonitorLoop()
        {
            while (isAppRunning)
            {
                try
                {
                    string statusUrl = string.Format("{0}/api/kiosk/status?room={1}&terminalId={2}", serverUrl, roomCode, terminalId);

                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(statusUrl);
                    req.Timeout = 3000;
                    req.Method = "GET";

                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    using (StreamReader reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    {
                        string json = reader.ReadToEnd();
                        bool isServerUnlocked = (json.IndexOf("\"isUnlocked\":true", StringComparison.OrdinalIgnoreCase) >= 0)
                                             || (json.IndexOf("\"isUnlocked\": true", StringComparison.OrdinalIgnoreCase) >= 0)
                                             || (json.IndexOf("\"unlocked\":true", StringComparison.OrdinalIgnoreCase) >= 0)
                                             || (json.IndexOf("\"unlocked\": true", StringComparison.OrdinalIgnoreCase) >= 0);

                        if (isServerUnlocked && isLocked)
                        {
                            // === CHUYỂN TRẠNG THÁI: KHOÁ -> ĐÃ MỞ KHOÁ ===
                            isLocked = false;

                            // 1. Gỡ bỏ Hook bàn phím ngay lập tức để Bác sĩ dùng đầy đủ phím tắt Windows
                            if (hookId != IntPtr.Zero)
                            {
                                UnhookWindowsHookEx(hookId);
                                hookId = IntPtr.Zero;
                            }

                            // 2. Tắt cửa sổ Kiosk trong chớp mắt (0.05s) giải phóng 100% Desktop
                            KillKioskProcesses();
                        }
                        else if (!isServerUnlocked && !isLocked)
                        {
                            // === CHUYỂN TRẠNG THÁI: HẾT CA TRỰC HOẶC BỊ KHOÁ LẠI ===
                            isLocked = true;

                            // 1. Kích hoạt lại Hook bàn phím
                            if (hookId == IntPtr.Zero)
                            {
                                hookId = SetHook(hookProc);
                            }

                            // 2. Mở lại màn hình Kiosk toàn màn hình
                            LaunchEdgeKiosk();
                        }
                        else if (isLocked)
                        {
                            // Đang trong trạng thái khoá:
                            // CHỈ mở lại khi Edge bị tắt hoàn toàn khỏi tiến trình VÀ đã qua cooldown 5 giây
                            if (!IsKioskBrowserRunning())
                            {
                                LaunchEdgeKiosk();
                            }
                        }
                    }
                }
                catch
                {
                    // Khi mất mạng tạm thời: nếu đang khoá thì bảo đảm Edge vẫn chạy
                    if (isLocked && !IsKioskBrowserRunning())
                    {
                        LaunchEdgeKiosk();
                    }
                }

                // Khi đang khoá: kiểm tra mỗi 1.5 giây. Khi đã mở khoá: kiểm tra mỗi 4 giây (tiết kiệm CPU)
                Thread.Sleep(isLocked ? 1500 : 4000);
            }
        }

        private static void CleanupAndExit()
        {
            isAppRunning = false;
            if (hookId != IntPtr.Zero)
            {
                UnhookWindowsHookEx(hookId);
                hookId = IntPtr.Zero;
            }
            RestoreSystemPolicies();
        }

        private static void RestoreSystemPolicies()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Policies\System", true))
                {
                    if (key != null)
                    {
                        key.DeleteValue("DisableTaskMgr", false);
                    }
                }
            }
            catch {}
        }

        // ====================================================================
        // HOOK BÀN PHÍM CẤP ĐỘ NHÂN (LOW-LEVEL KEYBOARD HOOK)
        // ====================================================================
        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        private static IntPtr SetHook(LowLevelKeyboardProc proc)
        {
            using (Process curProcess = Process.GetCurrentProcess())
            using (ProcessModule curModule = curProcess.MainModule)
            {
                return SetWindowsHookEx(13, proc, GetModuleHandle(curModule.ModuleName), 0);
            }
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && isLocked)
            {
                int vkCode = Marshal.ReadInt32(lParam);
                int flags = Marshal.ReadInt32(lParam + 8);
                bool alt = (flags & 0x20) != 0;
                bool ctrl = (Control.ModifierKeys & Keys.Control) != 0;
                bool shift = (Control.ModifierKeys & Keys.Shift) != 0;

                // 1. PHÍM NÓNG IT KHẨN CẤP: Ctrl + Alt + Shift + F12
                if (ctrl && alt && shift && vkCode == (int)Keys.F12)
                {
                    ShowEmergencyItPrompt();
                    return (IntPtr)1; // Chặn phím không cho lọt xuống hệ thống
                }

                // 2. CHẶN PHÍM WINDOWS (Trái & Phải)
                if (vkCode == 91 || vkCode == 92) return (IntPtr)1;

                // 3. CHẶN PHÍM APPLICATION / CONTEXT MENU
                if (vkCode == 93) return (IntPtr)1;

                // 4. CHẶN ALT + TAB, ALT + ESC, ALT + F4, ALT + SPACE
                if (alt && (vkCode == (int)Keys.Tab || vkCode == (int)Keys.Escape || vkCode == (int)Keys.F4 || vkCode == (int)Keys.Space))
                {
                    return (IntPtr)1;
                }

                // 5. CHẶN CTRL + ESC, CTRL + SHIFT + ESC (Task Manager)
                if (ctrl && (vkCode == (int)Keys.Escape))
                {
                    return (IntPtr)1;
                }

                // 6. CHẶN PHÍM CHỨC NĂNG F1 - F12 (Trừ F5 để tải lại trang)
                if (vkCode >= (int)Keys.F1 && vkCode <= (int)Keys.F12 && vkCode != (int)Keys.F5)
                {
                    return (IntPtr)1;
                }
            }

            return CallNextHookEx(hookId, nCode, wParam, lParam);
        }

        // ====================================================================
        // HỘP THOẠI MỞ KHOÁ IT KHẨN CẤP (TOPMOST DIALOG)
        // ====================================================================
        private static void ShowEmergencyItPrompt()
        {
            Thread t = new Thread(() =>
            {
                using (Form f = new Form())
                {
                    f.Text = "BỆNH VIỆN QUÂN Y 4 — BẢNG ĐIỀU KHIỂN IT";
                    f.FormBorderStyle = FormBorderStyle.FixedDialog;
                    f.StartPosition = FormStartPosition.CenterScreen;
                    f.Width = 460;
                    f.Height = 250;
                    f.TopMost = true;
                    f.MaximizeBox = false;
                    f.MinimizeBox = false;
                    f.BackColor = Color.FromArgb(15, 23, 42);
                    f.ForeColor = Color.White;

                    Label lblTitle = new Label
                    {
                        Text = "XÁC THỰC KỸ THUẬT VIÊN CNTT",
                        Font = new Font("Segoe UI", 11, FontStyle.Bold),
                        ForeColor = Color.FromArgb(45, 212, 191),
                        Location = new Point(20, 16),
                        AutoSize = true
                    };
                    f.Controls.Add(lblTitle);

                    Label lblSub = new Label
                    {
                        Text = string.Format("Máy trạm: {0} ({1}). Nhập Master PIN để thao tác:", roomCode, terminalId),
                        Font = new Font("Segoe UI", 9, FontStyle.Regular),
                        ForeColor = Color.FromArgb(148, 163, 184),
                        Location = new Point(20, 44),
                        Width = 400,
                        Height = 24
                    };
                    f.Controls.Add(lblSub);

                    TextBox txtPin = new TextBox
                    {
                        PasswordChar = '●',
                        Font = new Font("Segoe UI", 14, FontStyle.Bold),
                        Location = new Point(20, 72),
                        Width = 400,
                        TextAlign = HorizontalAlignment.Center,
                        BackColor = Color.FromArgb(30, 41, 59),
                        ForeColor = Color.White,
                        BorderStyle = BorderStyle.FixedSingle
                    };
                    f.Controls.Add(txtPin);

                    // Nút Mở khoá ca trực
                    Button btnUnlock = new Button
                    {
                        Text = "Mở khoá máy",
                        Font = new Font("Segoe UI", 9, FontStyle.Bold),
                        Location = new Point(20, 120),
                        Width = 125,
                        Height = 36,
                        BackColor = Color.FromArgb(13, 148, 136),
                        ForeColor = Color.White,
                        FlatStyle = FlatStyle.Flat,
                        Cursor = Cursors.Hand
                    };
                    btnUnlock.FlatAppearance.BorderSize = 0;

                    // Nút Thoát hoàn toàn Agent
                    Button btnExitAgent = new Button
                    {
                        Text = "Thoát Kiosk Agent",
                        Font = new Font("Segoe UI", 9, FontStyle.Bold),
                        Location = new Point(155, 120),
                        Width = 140,
                        Height = 36,
                        BackColor = Color.FromArgb(190, 24, 93),
                        ForeColor = Color.White,
                        FlatStyle = FlatStyle.Flat,
                        Cursor = Cursors.Hand
                    };
                    btnExitAgent.FlatAppearance.BorderSize = 0;

                    // Nút Đóng lại
                    Button btnCancel = new Button
                    {
                        Text = "Đóng",
                        Font = new Font("Segoe UI", 9, FontStyle.Regular),
                        Location = new Point(305, 120),
                        Width = 115,
                        Height = 36,
                        BackColor = Color.FromArgb(51, 65, 85),
                        ForeColor = Color.White,
                        FlatStyle = FlatStyle.Flat,
                        Cursor = Cursors.Hand
                    };
                    btnCancel.FlatAppearance.BorderSize = 0;

                    Func<bool> verifyPin = () =>
                    {
                        string pin = txtPin.Text.Trim();
                        if (string.IsNullOrEmpty(pin)) return false;

                        // Mã PIN offline khẩn cấp phòng khi mất mạng
                        if (pin == "888888" || pin == "bvqy4@it") return true;

                        try
                        {
                            string overrideUrl = string.Format("{0}/api/kiosk/override-pin", serverUrl);
                            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(overrideUrl);
                            req.Method = "POST";
                            req.ContentType = "application/json";
                            req.Timeout = 4000;

                            string body = string.Format("{{\"roomCode\":\"{0}\",\"pin\":\"{1}\",\"terminalId\":\"{2}\"}}", roomCode, pin, terminalId);
                            byte[] bytes = Encoding.UTF8.GetBytes(body);
                            req.ContentLength = bytes.Length;

                            using (Stream s = req.GetRequestStream()) { s.Write(bytes, 0, bytes.Length); }
                            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                            {
                                return (int)resp.StatusCode >= 200 && (int)resp.StatusCode < 300;
                            }
                        }
                        catch
                        {
                            return false;
                        }
                    };

                    btnUnlock.Click += (s, e) =>
                    {
                        btnUnlock.Enabled = false;
                        btnUnlock.Text = "Kiểm tra...";
                        if (verifyPin())
                        {
                            isLocked = false;
                            if (hookId != IntPtr.Zero)
                            {
                                UnhookWindowsHookEx(hookId);
                                hookId = IntPtr.Zero;
                            }
                            KillKioskProcesses();
                            MessageBox.Show(f, "Đã mở khoá thành công! Màn hình Desktop đã được giải phóng.", "Thông báo IT", MessageBoxButtons.OK, MessageBoxIcon.Information);
                            f.Close();
                            return;
                        }
                        MessageBox.Show(f, "Mã PIN không đúng hoặc máy chủ không phản hồi!", "Từ chối", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        btnUnlock.Enabled = true;
                        btnUnlock.Text = "Mở khoá máy";
                        txtPin.SelectAll();
                        txtPin.Focus();
                    };

                    btnExitAgent.Click += (s, e) =>
                    {
                        btnExitAgent.Enabled = false;
                        if (verifyPin())
                        {
                            MessageBox.Show(f, "Đang tắt hoàn toàn Kiosk Agent và khôi phục hệ thống...", "Thông báo IT", MessageBoxButtons.OK, MessageBoxIcon.Information);
                            f.Close();
                            CleanupAndExit();
                            KillKioskProcesses();
                            Environment.Exit(0);
                            return;
                        }
                        MessageBox.Show(f, "Mã PIN không đúng!", "Từ chối", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        btnExitAgent.Enabled = true;
                        txtPin.SelectAll();
                        txtPin.Focus();
                    };

                    btnCancel.Click += (s, e) => f.Close();

                    f.Controls.Add(btnUnlock);
                    f.Controls.Add(btnExitAgent);
                    f.Controls.Add(btnCancel);
                    f.AcceptButton = btnUnlock;
                    f.CancelButton = btnCancel;
                    f.ShowDialog();
                }
            });
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
        }

        // ====================================================================
        // WIN32 P/INVOKE CALLS
        // ====================================================================
        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);
    }
}
