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
        private static volatile bool isItPromptOpen = false;
        private static volatile bool lastNetworkState = false;
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
            Log(string.Format("Agent started. Server: {0}, Room: {1}, Terminal: {2}", serverUrl, roomCode, terminalId));

            // 3. Kích hoạt chính sách an ninh hệ thống cấp OS (Chặn WinKeys, DevTools, TaskMgr)
            ApplySystemSecurityPolicies();

            // 4. Khởi động Local HTTP Listener (cổng 28199) để nhận tín hiệu mở khoá trực tiếp từ trang web trong < 10ms
            StartLocalHttpListener();

            // 5. Cài đặt Hook bàn phím cấp độ nhân (Chặn 100% mọi phím khi đang khoá)
            hookId = SetHook(hookProc);

            // 6. Kiểm tra kết nối mạng tới máy chủ trước khi khởi động Kiosk (chống lỗi màn hình trắng khi vừa bật máy)
            WaitForNetworkAndInit();

            // 7. Khởi động luồng nền giám sát trạng thái từ máy chủ và cưỡng chế tiêu điểm Kiosk
            Thread monitorThread = new Thread(BackgroundMonitorLoop)
            {
                IsBackground = true,
                Name = "KioskStateMonitor"
            };
            monitorThread.Start();

            // 8. Chạy vòng lặp thông điệp Windows để duy trì hook
            Application.Run();

            // Dọn dẹp khi tắt
            CleanupAndExit();
        }

        private static void Log(string message)
        {
            try
            {
                string logDir = @"C:\QLBS_Kiosk";
                if (!Directory.Exists(logDir)) Directory.CreateDirectory(logDir);
                string logPath = Path.Combine(logDir, "agent.log");
                string line = string.Format("[{0:yyyy-MM-dd HH:mm:ss.fff}] {1}{2}", DateTime.Now, message, Environment.NewLine);
                File.AppendAllText(logPath, line);
            }
            catch {}
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
        // ÁP DỤNG CHÍNH SÁCH BẢO VỆ CẤP HỆ ĐIỀU HÀNH (OS & REGISTRY LEVEL)
        // ====================================================================
        private static void ApplySystemSecurityPolicies()
        {
            try
            {
                // 1. Chặn Task Manager và khoá Win+L
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Policies\System"))
                {
                    if (key != null)
                    {
                        key.SetValue("DisableTaskMgr", 1, RegistryValueKind.DWord);
                        key.SetValue("DisableLockWorkstation", 1, RegistryValueKind.DWord);
                    }
                }
            }
            catch {}

            try
            {
                // 2. Chặn F12 và Developer Tools trên Microsoft Edge & Google Chrome triệt để cấp Engine
                using (RegistryKey key = Registry.LocalMachine.CreateSubKey(@"SOFTWARE\Policies\Microsoft\Edge"))
                {
                    if (key != null) key.SetValue("DeveloperToolsAvailability", 2, RegistryValueKind.DWord);
                }
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"SOFTWARE\Policies\Microsoft\Edge"))
                {
                    if (key != null) key.SetValue("DeveloperToolsAvailability", 2, RegistryValueKind.DWord);
                }
            }
            catch {}
        }

        // ====================================================================
        // MÁY CHỦ HTTP CỤC BỘ (PORT 28199) — MỞ KHÓA TỨC THÌ TRONG < 10MS
        // ====================================================================
        private static void StartLocalHttpListener()
        {
            Thread t = new Thread(() =>
            {
                HttpListener listener = null;
                try
                {
                    listener = new HttpListener();
                    listener.Prefixes.Add("http://127.0.0.1:28199/");
                    listener.Prefixes.Add("http://localhost:28199/");
                    listener.Start();
                    Log("Local HttpListener started on port 28199 (instant unlock bridge)");

                    while (isAppRunning)
                    {
                        try
                        {
                            HttpListenerContext ctx = listener.GetContext();
                            ThreadPool.QueueUserWorkItem((state) => HandleLocalRequest(ctx));
                        }
                        catch (HttpListenerException)
                        {
                            break;
                        }
                        catch {}
                    }
                }
                catch (Exception ex)
                {
                    Log("HttpListener start warning: " + ex.Message);
                }
            })
            {
                IsBackground = true,
                Name = "LocalHttpListener"
            };
            t.Start();
        }

        private static void HandleLocalRequest(HttpListenerContext ctx)
        {
            try
            {
                HttpListenerRequest req = ctx.Request;
                HttpListenerResponse resp = ctx.Response;

                // Cung cấp CORS cho phép trang web Kiosk gọi nội bộ
                resp.Headers.Add("Access-Control-Allow-Origin", "*");
                resp.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                resp.Headers.Add("Access-Control-Allow-Headers", "*");

                if (req.HttpMethod == "OPTIONS")
                {
                    resp.StatusCode = 204;
                    resp.Close();
                    return;
                }

                string rawUrl = req.RawUrl.ToLowerInvariant();
                if (rawUrl.Contains("/unlock"))
                {
                    Log("Received local /unlock trigger from browser!");
                    UnlockKioskAndReleaseDesktop("Local browser trigger");
                    byte[] data = Encoding.UTF8.GetBytes("{\"success\":true,\"message\":\"Desktop released\"}");
                    resp.ContentType = "application/json";
                    resp.OutputStream.Write(data, 0, data.Length);
                    resp.Close();
                    return;
                }
                else if (rawUrl.Contains("/lock"))
                {
                    Log("Received local /lock trigger");
                    LockKioskAndLaunch("Local lock request");
                    byte[] data = Encoding.UTF8.GetBytes("{\"success\":true,\"message\":\"Kiosk locked\"}");
                    resp.ContentType = "application/json";
                    resp.OutputStream.Write(data, 0, data.Length);
                    resp.Close();
                    return;
                }
                else if (rawUrl.Contains("/status"))
                {
                    string statusJson = string.Format("{{\"isLocked\":{0},\"roomCode\":\"{1}\",\"terminalId\":\"{2}\"}}",
                        isLocked ? "true" : "false", roomCode, terminalId);
                    byte[] data = Encoding.UTF8.GetBytes(statusJson);
                    resp.ContentType = "application/json";
                    resp.OutputStream.Write(data, 0, data.Length);
                    resp.Close();
                    return;
                }
                else if (rawUrl.Contains("/it-mode"))
                {
                    bool enable = rawUrl.Contains("enable=1") || rawUrl.Contains("enable=true") || rawUrl.Contains("open=1");
                    isItPromptOpen = enable;
                    Log(string.Format("Local HTTP /it-mode: isItPromptOpen = {0}", isItPromptOpen));
                    byte[] data = Encoding.UTF8.GetBytes(string.Format("{{\"success\":true,\"isItPromptOpen\":{0}}}", isItPromptOpen ? "true" : "false"));
                    resp.ContentType = "application/json";
                    resp.OutputStream.Write(data, 0, data.Length);
                    resp.Close();
                    return;
                }
                else if (rawUrl.Contains("/it-prompt"))
                {
                    Log("Received local /it-prompt trigger from web");
                    ShowEmergencyItPrompt();
                    byte[] data = Encoding.UTF8.GetBytes("{\"success\":true,\"message\":\"IT Prompt launched\"}");
                    resp.ContentType = "application/json";
                    resp.OutputStream.Write(data, 0, data.Length);
                    resp.Close();
                    return;
                }

                resp.StatusCode = 404;
                resp.Close();
            }
            catch {}
        }

        // ====================================================================
        // CHUYỂN TRẠNG THÁI MỞ KHÓA & KHÓA LẠI MÁY TRẠM
        // ====================================================================

        public static void UnlockKioskAndReleaseDesktop(string source)
        {
            if (!isLocked) return;
            isLocked = false;
            Log(string.Format("UNLOCKED: {0} -> Killing Edge and releasing desktop 100%", source));

            // 1. Gỡ bỏ Hook bàn phím ngay lập tức để Bác sĩ dùng đầy đủ phím tắt Windows
            if (hookId != IntPtr.Zero)
            {
                UnhookWindowsHookEx(hookId);
                hookId = IntPtr.Zero;
            }

            // 2. Tắt cửa sổ Kiosk trong chớp mắt giải phóng 100% Desktop (không còn bất kỳ màn hình trắng/thanh nổi)
            KillKioskProcesses();
        }

        public static void LockKioskAndLaunch(string source)
        {
            if (isLocked) return;
            isLocked = true;
            Log(string.Format("LOCKED: {0} -> Hooking keyboard and launching Kiosk Edge", source));

            // 1. Kích hoạt lại Hook bàn phím
            if (hookId == IntPtr.Zero)
            {
                hookId = SetHook(hookProc);
            }

            // 2. Mở lại màn hình Kiosk toàn màn hình
            LaunchEdgeKiosk();
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
                    "--kiosk \"{0}\" --edge-kiosk-type=fullscreen --no-first-run --no-default-browser-check " +
                    "--disable-translate --disable-features=Translate,OptimizationHints,DevTools " +
                    "--disable-devtools --no-context-menu --disable-pinch --overscroll-history-navigation=0 " +
                    "--ignore-certificate-errors --user-data-dir=\"{1}\"",
                    targetUrl,
                    edgeProfileDir
                );

                Log(string.Format("Launching Kiosk browser: {0} {1}", browserPath, arguments));

                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = browserPath,
                    Arguments = arguments,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Maximized
                };

                Process.Start(psi);
            }
            catch (Exception ex)
            {
                Log("LaunchEdgeKiosk error: " + ex.Message);
            }
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
        // KIỂM TRA MẠNG TRƯỚC KHI KHỞI ĐỘNG KIOSK & TỰ ĐỘNG MỞ LẠI KHI CÓ MẠNG
        // ====================================================================
        private static void WaitForNetworkAndInit()
        {
            Log(string.Format("Waiting for network connection to {0} before launching Kiosk...", serverUrl));
            bool connected = false;
            int attempt = 0;

            while (isAppRunning && !connected)
            {
                attempt++;
                try
                {
                    string statusUrl = string.Format("{0}/api/kiosk/status?room={1}&terminalId={2}", serverUrl, roomCode, terminalId);
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(statusUrl);
                    req.Timeout = 3000;
                    req.Method = "GET";

                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    using (StreamReader reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    {
                        if (resp.StatusCode == HttpStatusCode.OK)
                        {
                            string json = reader.ReadToEnd();
                            connected = true;
                            lastNetworkState = true;
                            Log("Network connected successfully! Server responded with HTTP 200.");

                            bool isServerUnlocked = (json.IndexOf("\"isUnlocked\":true", StringComparison.OrdinalIgnoreCase) >= 0)
                                                 || (json.IndexOf("\"isUnlocked\": true", StringComparison.OrdinalIgnoreCase) >= 0)
                                                 || (json.IndexOf("\"unlocked\":true", StringComparison.OrdinalIgnoreCase) >= 0)
                                                 || (json.IndexOf("\"unlocked\": true", StringComparison.OrdinalIgnoreCase) >= 0);

                            if (isServerUnlocked)
                            {
                                Log("Initial state from server: Workstation is UNLOCKED -> Releasing desktop.");
                                UnlockKioskAndReleaseDesktop("Initial server state: unlocked");
                            }
                            else
                            {
                                Log("Initial state from server: Workstation is LOCKED -> Launching Edge Kiosk.");
                                LaunchEdgeKiosk();
                            }
                            return;
                        }
                    }
                }
                catch (Exception ex)
                {
                    if (attempt % 5 == 1)
                    {
                        Log(string.Format("Network check attempt #{0}: Not ready yet ({1}). Waiting 2s before retry...", attempt, ex.Message));
                    }
                }

                Thread.Sleep(2000);
            }
        }

        // ====================================================================
        // VÒNG LẶP THEO DÕI TRẠNG THÁI MỞ KHOÁ TỪ MÁY CHỦ & CƯỠNG CHẾ TIÊU ĐIỂM
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
                        bool justReconnected = !lastNetworkState;
                        lastNetworkState = true;

                        if (justReconnected)
                        {
                            Log("Network connection restored! Re-checking Kiosk state immediately...");
                        }

                        bool isServerUnlocked = (json.IndexOf("\"isUnlocked\":true", StringComparison.OrdinalIgnoreCase) >= 0)
                                             || (json.IndexOf("\"isUnlocked\": true", StringComparison.OrdinalIgnoreCase) >= 0)
                                             || (json.IndexOf("\"unlocked\":true", StringComparison.OrdinalIgnoreCase) >= 0)
                                             || (json.IndexOf("\"unlocked\": true", StringComparison.OrdinalIgnoreCase) >= 0);

                        if (isServerUnlocked && isLocked)
                        {
                            UnlockKioskAndReleaseDesktop("Server status unlocked (Background Monitor)");
                        }
                        else if (!isServerUnlocked && !isLocked)
                        {
                            LockKioskAndLaunch("Server status locked / shift ended (Background Monitor)");
                        }
                        else if (isLocked)
                        {
                            // Đang trong trạng thái khoá:
                            // Nếu vừa có mạng lại HOẶC Edge bị tắt hoàn toàn khỏi tiến trình -> Mở lại Kiosk liền
                            if (justReconnected || !IsKioskBrowserRunning())
                            {
                                LaunchEdgeKiosk();
                            }
                            else
                            {
                                EnforceKioskFocus();
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    if (lastNetworkState)
                    {
                        Log(string.Format("Network connection lost: {0}. Waiting for network to restore...", ex.Message));
                    }
                    lastNetworkState = false;

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

        private static void EnforceKioskFocus()
        {
            if (!isLocked || isItPromptOpen) return;
            try
            {
                IntPtr fgHwnd = GetForegroundWindow();
                if (fgHwnd == IntPtr.Zero) return;

                uint fgPid = 0;
                GetWindowThreadProcessId(fgHwnd, out fgPid);

                Process[] msedge = Process.GetProcessesByName("msedge");
                bool isEdgeForeground = false;
                IntPtr kioskHwnd = IntPtr.Zero;

                foreach (Process p in msedge)
                {
                    if (p.Id == fgPid)
                    {
                        isEdgeForeground = true;
                        break;
                    }
                    if (p.MainWindowHandle != IntPtr.Zero)
                    {
                        kioskHwnd = p.MainWindowHandle;
                    }
                }

                // Nếu cửa sổ phía trước không phải Edge Kiosk mà Kiosk đang chạy -> Đưa Edge Kiosk về lại lớp trên cùng
                if (!isEdgeForeground && kioskHwnd != IntPtr.Zero)
                {
                    ShowWindow(kioskHwnd, 3); // SW_MAXIMIZE = 3
                    SetForegroundWindow(kioskHwnd);
                }
            }
            catch {}
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
                        key.DeleteValue("DisableLockWorkstation", false);
                    }
                }
            }
            catch {}

            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer", true))
                {
                    if (key != null)
                    {
                        key.DeleteValue("NoWinKeys", false);
                    }
                }
            }
            catch {}

            try
            {
                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Policies\Microsoft\Edge", true))
                {
                    if (key != null)
                    {
                        key.DeleteValue("DeveloperToolsAvailability", false);
                    }
                }
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Policies\Microsoft\Edge", true))
                {
                    if (key != null)
                    {
                        key.DeleteValue("DeveloperToolsAvailability", false);
                    }
                }
            }
            catch {}
        }

        // ====================================================================
        // HOOK BÀN PHÍM CẤP ĐỘ NHÂN (LOW-LEVEL KEYBOARD HOOK — CHẶN 100% PHÍM)
        // ====================================================================
        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        private static IntPtr SetHook(LowLevelKeyboardProc proc)
        {
            try
            {
                using (Process curProcess = Process.GetCurrentProcess())
                using (ProcessModule curModule = curProcess.MainModule)
                {
                    IntPtr hMod = GetModuleHandle(curModule.ModuleName);
                    if (hMod == IntPtr.Zero) hMod = GetModuleHandle(null);
                    IntPtr h = SetWindowsHookEx(13, proc, hMod, 0);
                    if (h == IntPtr.Zero)
                    {
                        int err = Marshal.GetLastWin32Error();
                        Log(string.Format("SetWindowsHookEx failed with error code: {0}. Retrying with null hMod...", err));
                        h = SetWindowsHookEx(13, proc, IntPtr.Zero, 0);
                    }
                    Log(string.Format("Keyboard Hook installed: {0}", h));
                    return h;
                }
            }
            catch (Exception ex)
            {
                Log("SetHook exception: " + ex.Message);
                return IntPtr.Zero;
            }
        }

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        private static bool IsKeyDown(int vKey)
        {
            return (GetAsyncKeyState(vKey) & 0x8000) != 0;
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && isLocked)
            {
                int vkCode = Marshal.ReadInt32(lParam);
                int flags = Marshal.ReadInt32(lParam + 8);

                // 1. Kiểm tra tổ hợp phím nóng IT: Ctrl + Alt + Shift + F12
                // Lấy trạng thái vật lý thực tế của từng phím modifier trực tiếp từ nhân Windows
                bool isCtrl = IsKeyDown(0x11) || IsKeyDown(0xA2) || IsKeyDown(0xA3); // VK_CONTROL, VK_LCONTROL, VK_RCONTROL
                bool isAlt = ((flags & 0x20) != 0) || IsKeyDown(0x12) || IsKeyDown(0xA4) || IsKeyDown(0xA5); // VK_MENU, VK_LMENU, VK_RMENU
                bool isShift = IsKeyDown(0x10) || IsKeyDown(0xA0) || IsKeyDown(0xA1); // VK_SHIFT, VK_LSHIFT, VK_RSHIFT

                if (isCtrl && isAlt && isShift && vkCode == (int)Keys.F12)
                {
                    if (!isItPromptOpen)
                    {
                        ShowEmergencyItPrompt();
                    }
                    return (IntPtr)1; // Chặn phím không cho lọt xuống hệ thống
                }

                // 2. Nếu hộp thoại IT Master PIN đang hiển thị (cả Form C# lẫn Web modal), cho phép IT gõ phím để nhập PIN
                if (isItPromptOpen)
                {
                    // Vẫn chặn các phím nguy hiểm như WinKey, Alt+Tab để tránh thoát Desktop
                    bool isWinKey = (vkCode == 91 || vkCode == 92);
                    bool isAltTab = (isAlt && vkCode == (int)Keys.Tab);
                    if (isWinKey || isAltTab)
                    {
                        return (IntPtr)1;
                    }
                    // Cho phép toàn bộ phím số, chữ, Enter, Backspace, Space, Esc, phím điều hướng...
                    return CallNextHookEx(hookId, nCode, wParam, lParam);
                }

                // 3. KHI ĐANG KHOÁ KIOSK: CHẶN 100% TẤT CẢ CÁC PHÍM BÀN PHÍM!
                // Tuyệt đối không để lọt bất kỳ phím nào xuống Windows hoặc trình duyệt Edge!
                // Chặn toàn bộ:
                // - Phím Win (91, 92), D, Win+D, Win+R, Win+E, Win+X, Win+L, Win+S, Win+A, Win+Tab, Win+M
                // - F12, F1-F11
                // - Alt+Tab, Alt+Esc, Alt+F4, Alt+Space
                // - Ctrl+Shift+Esc, Ctrl+Esc, Ctrl+W, Ctrl+N, Ctrl+T, Ctrl+H, Ctrl+J, Ctrl+P, Ctrl+S, Ctrl+U
                // - Toàn bộ ký tự, số, phím chức năng, phím điều hướng, Space, Enter, Escape...
                // Triệt tiêu vĩnh viễn mọi hành vi can thiệp hoặc thoát ra Desktop khi chưa điểm danh thành công.
                return (IntPtr)1;
            }

            return CallNextHookEx(hookId, nCode, wParam, lParam);
        }

        // ====================================================================
        // HỘP THOẠI MỞ KHOÁ IT KHẨN CẤP (TOPMOST DIALOG)
        // ====================================================================
        private static void ShowEmergencyItPrompt()
        {
            isItPromptOpen = true;
            Thread t = new Thread(() =>
            {
                try
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
                                    if ((int)resp.StatusCode >= 200 && (int)resp.StatusCode < 300) return true;
                                }
                            }
                            catch (WebException wex)
                            {
                                HttpWebResponse errResp = wex.Response as HttpWebResponse;
                                if (errResp != null && errResp.StatusCode == HttpStatusCode.Unauthorized)
                                {
                                    return false; // Sai mã PIN
                                }
                                // Máy chủ mất kết nối: cho phép mã offline khẩn cấp
                                if (pin == "888888" || pin == "bvqy4@it")
                                {
                                    Log("Server unreachable. Used emergency offline Master PIN to unlock.");
                                    return true;
                                }
                            }
                            catch
                            {
                                if (pin == "888888" || pin == "bvqy4@it") return true;
                            }

                            return false;
                        };

                        btnUnlock.Click += (s, e) =>
                        {
                            btnUnlock.Enabled = false;
                            btnUnlock.Text = "Kiểm tra...";
                            if (verifyPin())
                            {
                                UnlockKioskAndReleaseDesktop("IT Emergency Master PIN verification");
                                MessageBox.Show(f, "Đã mở khoá thành công! Màn hình Desktop đã được giải phóng hoàn toàn.", "Thông báo IT", MessageBoxButtons.OK, MessageBoxIcon.Information);
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

                        f.FormClosed += (s, e) => { isItPromptOpen = false; };

                        f.Controls.Add(btnUnlock);
                        f.Controls.Add(btnExitAgent);
                        f.Controls.Add(btnCancel);
                        f.AcceptButton = btnUnlock;
                        f.CancelButton = btnCancel;
                        f.ShowDialog();
                    }
                }
                finally
                {
                    isItPromptOpen = false;
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

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    }
}
