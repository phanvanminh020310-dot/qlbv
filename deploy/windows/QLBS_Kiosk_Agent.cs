using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

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
        private static Process edgeProcess = null;

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
                return; // Đã có một Agent đang chạy bảo vệ hệ thống
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // 2. Nạp cấu hình từ tệp config.ini
            LoadConfig();

            // 3. Cài đặt Hook bàn phím cấp độ nhân (Chặn Win, Alt+Tab, Taskmgr...)
            hookId = SetHook(hookProc);

            // 4. Khởi động tiến trình Edge Kiosk toàn màn hình
            LaunchEdgeKiosk();

            // 5. Khởi động luồng nền giám sát trạng thái mở khoá từ máy chủ
            Thread monitorThread = new Thread(BackgroundMonitorLoop)
            {
                IsBackground = true,
                Name = "KioskStateMonitor"
            };
            monitorThread.Start();

            // 6. Chạy vòng lặp thông điệp Windows để xử lý Hook
            Application.Run();

            // Dọn dẹp khi tắt
            UnhookWindowsHookEx(hookId);
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

        private static void LaunchEdgeKiosk()
        {
            try
            {
                KillKioskProcesses();

                string browserPath = FindBrowserExecutable();
                if (string.IsNullOrEmpty(browserPath)) return;

                if (!Directory.Exists(edgeProfileDir))
                {
                    Directory.CreateDirectory(edgeProfileDir);
                }

                string targetUrl = string.Format("{0}/kiosk/{1}?terminalId={2}", serverUrl, roomCode, terminalId);
                string arguments = string.Format(
                    "--kiosk \"{0}\" --edge-kiosk-type=fullscreen --no-first-run --no-default-browser-check --disable-translate --disable-features=Translate,OptimizationHints --user-data-dir=\"{1}\"",
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

                edgeProcess = Process.Start(psi);
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
                if (edgeProcess != null && !edgeProcess.HasExited)
                {
                    edgeProcess.Kill();
                }
            }
            catch {}
            edgeProcess = null;

            // Tìm và tắt các tiến trình trình duyệt chạy với profile Kiosk riêng
            try
            {
                Process[] procs = Process.GetProcessesByName("msedge");
                foreach (Process p in procs)
                {
                    try
                    {
                        // Kiểm tra nếu tiến trình thuộc profile kiosk
                        p.Kill();
                    }
                    catch {}
                }
            }
            catch {}
        }

        private static void BackgroundMonitorLoop()
        {
            while (isAppRunning)
            {
                try
                {
                    string statusUrl = string.Format("{0}/api/kiosk/status?room={1}&terminalId={2}", serverUrl, roomCode, terminalId);

                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(statusUrl);
                    req.Timeout = 4000;
                    req.Method = "GET";

                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    using (StreamReader reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    {
                        string json = reader.ReadToEnd();
                        bool isServerUnlocked = json.Contains("\"unlocked\":true");

                        if (isServerUnlocked && isLocked)
                        {
                            // === SỰ KIỆN: BÁC SĨ MỞ KHOÁ THÀNH CÔNG ===
                            isLocked = false;

                            // 1. Tắt ngay cửa sổ Kiosk trong chớp mắt (0.05 giây)
                            KillKioskProcesses();

                            // 2. Gỡ bỏ Hook bàn phím để Bác sĩ dùng các phím tắt Windows tự do
                            if (hookId != IntPtr.Zero)
                            {
                                UnhookWindowsHookEx(hookId);
                                hookId = IntPtr.Zero;
                            }
                        }
                        else if (!isServerUnlocked && !isLocked)
                        {
                            // === SỰ KIỆN: HẾT CA TRỰC HOẶC PHÒNG KHÁM BỊ KHOÁ LẠI ===
                            isLocked = true;

                            // 1. Cài đặt lại Hook bàn phím bảo vệ máy trạm
                            if (hookId == IntPtr.Zero)
                            {
                                hookId = SetHook(hookProc);
                            }

                            // 2. Mở lại màn hình Kiosk toàn màn hình
                            LaunchEdgeKiosk();
                        }
                        else if (isLocked)
                        {
                            // Trong lúc đang khoá, nếu trình duyệt bị tắt bất thường -> Tự mở lại ngay
                            if (edgeProcess == null || edgeProcess.HasExited)
                            {
                                LaunchEdgeKiosk();
                            }
                        }
                    }
                }
                catch
                {
                    // Khi mất mạng tạm thời, giữ nguyên trạng thái an toàn
                }

                // Khi đang khoá: kiểm tra mỗi 1 giây. Khi đã mở khoá: kiểm tra mỗi 4 giây (tiết kiệm CPU/RAM)
                Thread.Sleep(isLocked ? 1000 : 4000);
            }
        }

        // ====================================================================
        // HOOK BÀN PHÍM CẤP ĐỘ NHÂN (LOW-LEVEL KEYBOARD HOOK)
        // Chặn 100% phím Windows, Alt+Tab, Task Manager, Alt+F4, F1-F12
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

                // 4. CHẶN ALT + TAB, ALT + ESC, ALT + F4
                if (alt && (vkCode == (int)Keys.Tab || vkCode == (int)Keys.Escape || vkCode == (int)Keys.F4 || vkCode == (int)Keys.Space))
                {
                    return (IntPtr)1;
                }

                // 5. CHẶN CTRL + ESC, CTRL + SHIFT + ESC (Task Manager)
                if (ctrl && (vkCode == (int)Keys.Escape))
                {
                    return (IntPtr)1;
                }

                // 6. CHẶN PHÍM CHỨC NĂNG F1 - F12 (Trừ khi nhấn F5 tải lại trang)
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
                    f.Text = "BỆNH VIỆN QUÂN Y 4 — MỞ KHOÁ IT KHẨN CẤP";
                    f.FormBorderStyle = FormBorderStyle.FixedDialog;
                    f.StartPosition = FormStartPosition.CenterScreen;
                    f.Width = 440;
                    f.Height = 220;
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
                        Location = new Point(20, 18),
                        AutoSize = true
                    };
                    f.Controls.Add(lblTitle);

                    Label lblSub = new Label
                    {
                        Text = string.Format("Mở khoá khẩn cấp máy trạm {0}. Vui lòng nhập Master PIN:", roomCode),
                        Font = new Font("Segoe UI", 9, FontStyle.Regular),
                        ForeColor = Color.FromArgb(148, 163, 184),
                        Location = new Point(20, 48),
                        Width = 380,
                        Height = 35
                    };
                    f.Controls.Add(lblSub);

                    TextBox txtPin = new TextBox
                    {
                        PasswordChar = '●',
                        Font = new Font("Segoe UI", 14, FontStyle.Bold),
                        Location = new Point(20, 85),
                        Width = 380,
                        TextAlign = HorizontalAlignment.Center,
                        BackColor = Color.FromArgb(30, 41, 59),
                        ForeColor = Color.White,
                        BorderStyle = BorderStyle.FixedSingle
                    };
                    f.Controls.Add(txtPin);

                    Button btnOk = new Button
                    {
                        Text = "Mở khoá ngay",
                        Font = new Font("Segoe UI", 9, FontStyle.Bold),
                        Location = new Point(20, 125),
                        Width = 185,
                        Height = 36,
                        BackColor = Color.FromArgb(13, 148, 136),
                        ForeColor = Color.White,
                        FlatStyle = FlatStyle.Flat
                    };
                    btnOk.FlatAppearance.BorderSize = 0;
                    btnOk.Click += (s, e) =>
                    {
                        string pin = txtPin.Text.Trim();
                        if (string.IsNullOrEmpty(pin)) return;

                        btnOk.Enabled = false;
                        btnOk.Text = "Đang kiểm tra...";

                        try
                        {
                            string overrideUrl = string.Format("{0}/api/kiosk/override-pin", serverUrl);
                            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(overrideUrl);
                            req.Method = "POST";
                            req.ContentType = "application/json";
                            req.Timeout = 5000;

                            string body = string.Format("{{\"roomCode\":\"{0}\",\"pin\":\"{1}\",\"terminalId\":\"{2}\"}}", roomCode, pin, terminalId);
                            byte[] bytes = Encoding.UTF8.GetBytes(body);
                            req.ContentLength = bytes.Length;

                            using (Stream stream = req.GetRequestStream())
                            {
                                stream.Write(bytes, 0, bytes.Length);
                            }

                            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                            {
                                if ((int)resp.StatusCode >= 200 && (int)resp.StatusCode < 300)
                                {
                                    MessageBox.Show(f, "Mở khoá khẩn cấp thành công!\nMáy trạm phòng khám đã giải phóng hoàn toàn.", "Thông báo IT", MessageBoxButtons.OK, MessageBoxIcon.Information);
                                    f.Close();

                                    // Giải phóng máy trạm ngay
                                    isLocked = false;
                                    KillKioskProcesses();
                                    if (hookId != IntPtr.Zero)
                                    {
                                        UnhookWindowsHookEx(hookId);
                                        hookId = IntPtr.Zero;
                                    }
                                    return;
                                }
                            }
                        }
                        catch
                        {
                            MessageBox.Show(f, "Mã PIN IT không chính xác hoặc không kết nối được máy chủ!", "Từ chối mở khoá", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        }

                        btnOk.Enabled = true;
                        btnOk.Text = "Mở khoá ngay";
                        txtPin.SelectAll();
                        txtPin.Focus();
                    };
                    f.Controls.Add(btnOk);

                    Button btnCancel = new Button
                    {
                        Text = "Đóng lại",
                        Font = new Font("Segoe UI", 9, FontStyle.Regular),
                        Location = new Point(215, 125),
                        Width = 185,
                        Height = 36,
                        BackColor = Color.FromArgb(51, 65, 85),
                        ForeColor = Color.White,
                        FlatStyle = FlatStyle.Flat
                    };
                    btnCancel.FlatAppearance.BorderSize = 0;
                    btnCancel.Click += (s, e) => f.Close();
                    f.Controls.Add(btnCancel);

                    f.AcceptButton = btnOk;
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
