// QLBS Kiosk 2 — standalone WinForms workstation, C# 5 / .NET Framework 4.x.
// Build: csc /target:winexe /optimize+ /reference:System.dll,System.Core.dll,System.Drawing.dll,System.Windows.Forms.dll,System.Web.Extensions.dll QLBS_Kiosk.cs
// No browser, WebView, local HTTP unlock bridge, external DLL, webcam or persisted keyboard restrictions.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Security.AccessControl;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Net;
using Microsoft.Win32;
using Net.Codecrete.QrCodeGenerator;

[assembly: AssemblyTitle("QLBS Kiosk")]
[assembly: AssemblyDescription("Xác thực ca trực — Bệnh viện quân y 4")]
[assembly: AssemblyCompany("Bệnh viện quân y 4")]
[assembly: AssemblyProduct("QLBS Kiosk")]
[assembly: AssemblyVersion("2.0.4.0")]
[assembly: AssemblyFileVersion("2.0.4.0")]
[assembly: AssemblyCopyright(QLBS.Kiosk.ThirdParty.Notice)]

namespace QLBS.Kiosk
{
    internal static class ThirdParty
    {
        // Embedded in the EXE's legal-copyright metadata, not just a source-code comment.
        internal const string Notice = "QR generator: Copyright (c) Manuel Bleichenbacher; Copyright (c) Project Nayuki. " +
            "https://github.com/manuelbl/QrCodeGenerator/tree/v1.6.0 (MIT License). " +
            "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the Software), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: " +
            "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. " +
            "THE SOFTWARE IS PROVIDED AS IS, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.";
    }

    internal static class Program
    {
        internal const string Version = "2.0.4";
        internal static readonly string InstallDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "QLBS Kiosk");
        internal static readonly string DataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "QLBS", "Kiosk");
        internal static readonly string ConfigPath = Path.Combine(DataDirectory, "config.ini");
        internal const string LegacyDirectory = @"C:\QLBS_Kiosk";
        private static Mutex mutex;

        [STAThread]
        private static int Main(string[] args)
        {
            Options options = null;
            try
            {
                options = Options.Parse(args);
                if (options.Has("self-test")) return SelfTests.Run(options.Get("output"));
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2; normal Windows certificate validation.
                ServicePointManager.DefaultConnectionLimit = 12;
                if (options.Has("install") && options.Has("quiet")) return Installer.InstallFromOptions(options);
                if (options.Has("uninstall") && options.Has("quiet")) return Installer.Uninstall(options);
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                if (options.Has("snapshot")) return SelfTests.Snapshot(options.Get("snapshot"), options.Has("scanned"));
                try { Native.SetProcessDPIAware(); } catch (EntryPointNotFoundException) { }
                if (options.Has("uninstall")) return Installer.Uninstall(options);
                if (options.Has("install")) return Installer.InstallFromOptions(options);
                bool explicitSetup = options.Has("setup") ||
                    (args.Length == 0 && !String.Equals(Path.GetFullPath(Application.ExecutablePath), Path.Combine(InstallDirectory, "QLBS_Kiosk.exe"), StringComparison.OrdinalIgnoreCase));
                // HKLM Run is machine-wide and the online kiosk policy applies to every
                // interactive Windows account, including local/domain Administrators and UAC-filtered tokens.
                // Installation and removal still require UAC; there is no account-based runtime bypass.
                if (explicitSetup || !File.Exists(ConfigPath))
                {
                    Application.Run(new SetupForm());
                    return 0;
                }
                bool created;
                mutex = new Mutex(true, @"Local\QLBS_Kiosk_Standalone_v2", out created);
                if (!created) return 0;
                KioskConfig config = KioskConfig.Load(ConfigPath);
                Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
                using (KioskContext context = new KioskContext(config)) Application.Run(context);
                return 0;
            }
            catch (Exception ex)
            {
                Log.Write("Fatal: " + ex.GetType().Name + ": " + ex.Message);
                if (!Array.Exists(args, delegate(string argument) { return String.Equals(argument, "/quiet", StringComparison.OrdinalIgnoreCase) || String.Equals(argument, "--quiet", StringComparison.OrdinalIgnoreCase); }))
                    MessageBox.Show("Không khởi động được QLBS Kiosk.\n\n" + ex.Message + "\n\nLiên hệ CNTT; nhật ký nằm trong %LOCALAPPDATA%\\QLBS\\Kiosk.", "QLBS Kiosk", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            finally
            {
                if (mutex != null) { mutex.Close(); mutex = null; }
            }
        }
    }

    internal sealed class Options
    {
        private readonly Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        internal bool Has(string key) { return values.ContainsKey(key); }
        internal string Get(string key) { string value; return values.TryGetValue(key, out value) ? value : ""; }
        internal static Options Parse(string[] args)
        {
            Options result = new Options();
            HashSet<string> switches = new HashSet<string>(new string[] { "setup", "install", "uninstall", "quiet", "no-start", "purge", "self-test", "scanned" }, StringComparer.OrdinalIgnoreCase);
            HashSet<string> parameters = new HashSet<string>(new string[] { "server", "room", "snapshot", "output" }, StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < args.Length; i++)
            {
                string key = args[i].TrimStart('-', '/');
                if (!switches.Contains(key) && !parameters.Contains(key)) throw new ArgumentException("Tham số không được hỗ trợ: " + args[i]);
                string value = "true";
                if (parameters.Contains(key))
                {
                    if (++i >= args.Length) throw new ArgumentException("Thiếu giá trị cho " + key);
                    value = args[i];
                }
                if (result.values.ContainsKey(key)) throw new ArgumentException("Tham số bị trùng: " + key);
                result.values.Add(key, value);
            }
            return result;
        }
    }

    internal sealed class KioskConfig
    {
        internal string ServerUrl;
        internal string RoomCode;
        internal string TerminalId;
        internal static string NormalizeServer(string value)
        {
            Uri uri;
            if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out uri) ||
                (uri.Scheme != "http" && uri.Scheme != "https") || uri.UserInfo.Length != 0 ||
                uri.Query.Length != 0 || uri.Fragment.Length != 0 || uri.AbsolutePath != "/")
                throw new ArgumentException("Nhập địa chỉ gốc HTTP/HTTPS, ví dụ https://qlbv.benhvien.vn (không có /api, tài khoản hay tham số).");
            return uri.GetLeftPart(UriPartial.Authority).TrimEnd('/');
        }
        internal void Validate()
        {
            ServerUrl = NormalizeServer(ServerUrl ?? "");
            RoomCode = (RoomCode ?? "").Trim().ToUpperInvariant();
            if (!Regex.IsMatch(RoomCode, @"^[A-Z0-9][A-Z0-9._-]{0,63}$"))
                throw new ArgumentException("Mã phòng gồm 1–64 ký tự chữ, số, dấu chấm, gạch ngang hoặc gạch dưới.");
            if (!Regex.IsMatch(TerminalId ?? "", @"^[A-Za-z0-9._:-]{16,128}$")) throw new ArgumentException("Terminal ID không hợp lệ; hãy chạy lại bộ cài.");
        }
        internal static KioskConfig Load(string path)
        {
            KioskConfig result = new KioskConfig();
            foreach (string line in File.ReadAllLines(path, Encoding.UTF8))
            {
                string text = line.Trim();
                if (text.StartsWith("#") || text.StartsWith(";")) continue;
                int index = text.IndexOf('=');
                if (index < 1) continue;
                string key = text.Substring(0, index).Trim().ToLowerInvariant();
                string value = text.Substring(index + 1).Trim();
                if (key == "serverurl") result.ServerUrl = value;
                if (key == "roomcode") result.RoomCode = value;
                if (key == "terminalid") result.TerminalId = value;
            }
            result.Validate();
            return result;
        }
        internal string Serialize()
        {
            Validate();
            return "# QLBS Kiosk " + Program.Version + " — do not clone terminalId to another PC\r\nserverUrl=" + ServerUrl + "\r\nroomCode=" + RoomCode + "\r\nterminalId=" + TerminalId + "\r\n";
        }
        internal static KioskConfig ForInstall(string server, string room)
        {
            KioskConfig old = null;
            try { old = Load(Program.ConfigPath); } catch (Exception) { }
            if (old == null) try { old = Load(Path.Combine(Program.LegacyDirectory, "config.ini")); } catch (Exception) { }
            KioskConfig config = new KioskConfig { ServerUrl = server, RoomCode = room, TerminalId = "term_" + Guid.NewGuid().ToString("N") };
            if (old != null && String.Equals(old.RoomCode, room.Trim(), StringComparison.OrdinalIgnoreCase)) config.TerminalId = old.TerminalId;
            config.Validate();
            return config;
        }
    }

    internal static class Log
    {
        private static readonly object gate = new object();
        internal static void Write(string text)
        {
            try
            {
                lock (gate)
                {
                    string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "QLBS", "Kiosk");
                    Directory.CreateDirectory(directory);
                    string path = Path.Combine(directory, "kiosk.log");
                    if (File.Exists(path) && new FileInfo(path).Length > 1024 * 1024)
                    {
                        if (File.Exists(path + ".1")) File.Delete(path + ".1");
                        File.Move(path, path + ".1");
                    }
                    // Never log QR URLs, PINs, claim tokens, face images or embeddings.
                    File.AppendAllText(path, DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) + " " + text + Environment.NewLine, Encoding.UTF8);
                }
            }
            catch (Exception) { /* Logging must not interrupt a clinical workstation. */ }
        }
    }

    internal static class Json
    {
        internal static Dictionary<string, object> Object(object value)
        {
            Dictionary<string, object> result = value as Dictionary<string, object>;
            return result ?? new Dictionary<string, object>();
        }
        internal static object Value(Dictionary<string, object> data, string key) { object value; return data.TryGetValue(key, out value) ? value : null; }
        internal static string Text(Dictionary<string, object> data, string key) { return Value(data, key) as string ?? ""; }
        internal static bool Flag(Dictionary<string, object> data, string key) { return Value(data, key) is bool && (bool)Value(data, key); }
        internal static double Number(Dictionary<string, object> data, string key)
        {
            object value = Value(data, key);
            if (!(value is int) && !(value is long) && !(value is double) && !(value is decimal)) return 0;
            double number = Convert.ToDouble(value, CultureInfo.InvariantCulture);
            return Double.IsNaN(number) || Double.IsInfinity(number) ? 0 : number;
        }
        internal static Dictionary<string, object> Decode(string text)
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer { MaxJsonLength = 131072, RecursionLimit = 24 };
            Dictionary<string, object> data = Object(serializer.DeserializeObject(text));
            // Correctly unwrap { success: true, data: null }; never reinterpret an envelope as a state.
            if (data.ContainsKey("data")) return Object(data["data"]);
            return data;
        }
        internal static string Encode(object value) { return new JavaScriptSerializer().Serialize(value); }
    }

    internal sealed class ServerClock
    {
        private double baseMs;
        private long baseTicks;
        internal bool IsSynchronized { get; private set; }
        internal void Sync(double serverTime, double transitMs)
        {
            if (serverTime < 1577836800000d || serverTime > 4102444800000d) throw new InvalidDataException("Giờ máy chủ không hợp lệ.");
            baseMs = serverTime + Math.Max(0, Math.Min(transitMs, 3000));
            baseTicks = Stopwatch.GetTimestamp();
            IsSynchronized = true;
        }
        internal double Now { get { return baseMs + (Stopwatch.GetTimestamp() - baseTicks) * 1000d / Stopwatch.Frequency; } }
        internal DateTime BangkokNow { get { return new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(Now).AddHours(7); } }
    }

    internal sealed class KioskSnapshot
    {
        internal double ServerTime, ExpiresAt, ShiftEndMs;
        internal bool KioskRequired, IsUnlocked, Scanned;
        internal int QrSeconds, BufferSeconds;
        internal string RoomName, SessionId, QrUrl, DoctorName, ShiftName, ShiftHours, DutyDate;
        internal QrCode Qr;
        internal static KioskSnapshot Parse(Dictionary<string, object> data, KioskConfig config)
        {
            if (Json.Number(data, "protocolVersion") < 2) throw new InvalidDataException("Cần cập nhật máy chủ QLBV lên bản hỗ trợ Kiosk 2 trước khi cài máy trạm.");
            Dictionary<string, object> room = Json.Object(Json.Value(data, "room"));
            if (!Json.Flag(data, "roomExists") || !String.Equals(Json.Text(room, "code"), config.RoomCode, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Không tìm thấy đúng mã phòng khám đang hoạt động. Kiểm tra danh mục phòng trên QLBV.");
            if (Json.Text(data, "terminalId") != config.TerminalId) throw new InvalidDataException("Máy chủ trả trạng thái của máy trạm khác.");
            KioskSnapshot result = new KioskSnapshot();
            result.ServerTime = Json.Number(data, "serverTime");
            if (result.ServerTime < 1577836800000d || result.ServerTime > 4102444800000d) throw new InvalidDataException("Không nhận được thời gian chuẩn từ máy chủ.");
            result.RoomName = Json.Text(room, "name");
            result.KioskRequired = Json.Flag(data, "kioskRequired");
            result.IsUnlocked = Json.Flag(data, "isUnlocked");
            result.ShiftEndMs = Json.Number(data, "shiftEndMs");
            // A missing/false flag means the server did not confirm an active published shift.
            // Release rather than making a local or stale schedule decide Windows lock state.
            if (!result.KioskRequired) { result.IsUnlocked = true; return result; }
            if (result.IsUnlocked && (result.ShiftEndMs <= result.ServerTime || result.ShiftEndMs > result.ServerTime + 48 * 3600000d))
                throw new InvalidDataException("Mốc kết thúc ca trực không hợp lệ. Đang đối soát lại máy chủ.");
            Dictionary<string, object> duty = Json.Object(Json.Value(data, "currentScheduled"));
            result.DoctorName = (Json.Text(duty, "title") + " " + Json.Text(duty, "fullName")).Trim();
            result.ShiftName = Json.Text(duty, "shiftName");
            result.ShiftHours = Json.Text(duty, "startTime") + " – " + Json.Text(duty, "endTime");
            result.DutyDate = Json.Text(duty, "dutyDate");
            if (!result.IsUnlocked)
            {
                Dictionary<string, object> qr = Json.Object(Json.Value(data, "qrSession"));
                result.SessionId = Json.Text(qr, "sessionId");
                Guid id;
                if (!Guid.TryParse(result.SessionId, out id)) throw new InvalidDataException("Phiên QR máy chủ không hợp lệ.");
                result.QrUrl = Json.Text(qr, "qrUrl");
                Uri uri;
                if (result.QrUrl.Length > 2048 || !Uri.TryCreate(result.QrUrl, UriKind.Absolute, out uri) ||
                    (uri.Scheme != "http" && uri.Scheme != "https") || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 ||
                    !String.Equals(uri.GetLeftPart(UriPartial.Authority), config.ServerUrl, StringComparison.OrdinalIgnoreCase) ||
                    uri.AbsolutePath != "/scan/" + result.SessionId || (config.ServerUrl.StartsWith("https:", StringComparison.OrdinalIgnoreCase) && uri.Scheme != "https"))
                    throw new InvalidDataException("Địa chỉ QR không hợp lệ hoặc không dùng HTTPS như máy chủ.");
                result.ExpiresAt = Json.Number(qr, "expiresAt");
                result.QrSeconds = (int)Json.Number(qr, "totalExpiresSeconds");
                result.BufferSeconds = (int)Json.Number(qr, "faceVerifyBufferSeconds");
                result.Scanned = Json.Number(qr, "scannedAt") > 0 || Json.Text(qr, "status") == "SCANNED";
                if (result.QrSeconds < 10 || result.QrSeconds > 600 || result.BufferSeconds < 10 || result.BufferSeconds > 300 ||
                    result.ExpiresAt <= result.ServerTime || result.ExpiresAt > result.ServerTime + 601000)
                    throw new InvalidDataException("Thời hạn phiên QR không hợp lệ; đang đồng bộ lại.");
                if (!result.Scanned) result.Qr = QrCode.EncodeText(result.QrUrl, QrCode.Ecc.Medium);
            }
            return result;
        }
    }

    internal sealed class ApiClient : IDisposable
    {
        private readonly KioskConfig config;
        private readonly object gate = new object();
        private readonly HashSet<HttpWebRequest> requests = new HashSet<HttpWebRequest>();
        private bool disposed;
        internal ApiClient(KioskConfig config) { this.config = config; }
        internal string Query { get { return "room=" + Uri.EscapeDataString(config.RoomCode) + "&terminalId=" + Uri.EscapeDataString(config.TerminalId) + "&clientOrigin=" + Uri.EscapeDataString(config.ServerUrl); } }
        internal HttpWebRequest Open(string path, bool stream)
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(config.ServerUrl + path);
            request.Method = "GET";
            request.Accept = stream ? "text/event-stream" : "application/json";
            request.UserAgent = "QLBS-Kiosk/" + Program.Version;
            request.Headers[HttpRequestHeader.CacheControl] = "no-cache, no-store";
            request.AllowAutoRedirect = false; // Do not redirect credentials or silently change hospital origins.
            request.Timeout = 6000;
            request.ReadWriteTimeout = stream ? 40000 : 6000;
            request.KeepAlive = true;
            request.ServicePoint.Expect100Continue = false;
            lock (gate)
            {
                if (disposed) throw new ObjectDisposedException("ApiClient");
                requests.Add(request);
            }
            return request;
        }
        internal void Complete(HttpWebRequest request) { lock (gate) requests.Remove(request); }
        internal Dictionary<string, object> Read(string path, object body)
        {
            HttpWebRequest request = Open(path, false);
            try
            {
                if (body != null)
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(Json.Encode(body));
                    request.Method = "POST";
                    request.ContentType = "application/json; charset=utf-8";
                    request.ContentLength = bytes.Length;
                    using (Stream stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
                }
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    if (response.StatusCode != HttpStatusCode.OK && response.StatusCode != HttpStatusCode.Created) throw new InvalidDataException("Máy chủ trả mã HTTP không mong đợi.");
                    using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    {
                        char[] buffer = new char[4096];
                        StringBuilder text = new StringBuilder();
                        int read;
                        while ((read = reader.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            if (text.Length + read > 131072) throw new InvalidDataException("Phản hồi máy chủ vượt giới hạn.");
                            text.Append(buffer, 0, read);
                        }
                        return Json.Decode(text.ToString());
                    }
                }
            }
            catch (WebException ex)
            {
                using (HttpWebResponse response = ex.Response as HttpWebResponse)
                {
                    if (response != null && (int)response.StatusCode == 429) throw new InvalidOperationException("Đã vượt số lần nhập PIN. Vui lòng chờ 10 phút hoặc liên hệ quản trị.");
                    if (response != null && (int)response.StatusCode == 401) throw new InvalidOperationException("PIN không đúng hoặc chưa được cấu hình trên máy chủ.");
                    if (response != null) throw new InvalidOperationException("Máy chủ đang chưa sẵn sàng (HTTP " + (int)response.StatusCode + ").");
                }
                throw new InvalidOperationException("Chưa kết nối được máy chủ. Kiểm tra mạng nội bộ và chứng chỉ HTTPS.");
            }
            finally { Complete(request); request.Abort(); }
        }
        internal KioskSnapshot Status() { return KioskSnapshot.Parse(Read("/api/kiosk/status?" + Query, null), config); }
        internal KioskSnapshot Preflight()
        {
            KioskSnapshot snapshot = Status();
            HttpWebRequest request = Open("/scan/" + Guid.NewGuid().ToString(), false);
            try
            {
                // A plain HTML GET does not execute the phone's claim JavaScript or consume a real QR.
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    if (response.StatusCode != HttpStatusCode.OK || !response.ContentType.StartsWith("text/html", StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("Đây không phải địa chỉ web QLBV dành cho điện thoại. Không dùng cổng API 4000.");
            }
            catch (WebException) { throw new InvalidDataException("Không tìm thấy giao diện quét điện thoại. Nhập địa chỉ web QLBV, không phải địa chỉ API 4000."); }
            finally { Complete(request); request.Abort(); }
            return snapshot;
        }
        public void Dispose()
        {
            lock (gate)
            {
                disposed = true;
                foreach (HttpWebRequest request in requests) { try { request.Abort(); } catch (Exception) { } }
                requests.Clear();
            }
        }
    }

    internal sealed class SseParser
    {
        private string eventName = "message";
        private readonly StringBuilder data = new StringBuilder();
        internal void Push(string line, Action<string, string> dispatch)
        {
            if (line.Length > 32768) throw new InvalidDataException("SSE line too long.");
            if (line.Length == 0)
            {
                if (data.Length > 0) dispatch(eventName, data.ToString(0, data.Length - 1));
                data.Length = 0;
                eventName = "message";
                return;
            }
            if (line[0] == ':') return;
            int colon = line.IndexOf(':');
            string name = colon < 0 ? line : line.Substring(0, colon);
            string value = colon < 0 ? "" : line.Substring(colon + 1);
            if (value.StartsWith(" ")) value = value.Substring(1);
            if (name == "event") eventName = value;
            if (name == "data")
            {
                if (data.Length + value.Length > 65536) throw new InvalidDataException("SSE event too long.");
                data.Append(value).Append('\n');
            }
        }
        internal static string ReadLine(TextReader reader)
        {
            StringBuilder line = new StringBuilder();
            int value;
            while ((value = reader.Read()) >= 0)
            {
                if (value == '\n') return line.ToString().TrimEnd('\r');
                if (line.Length >= 32768) throw new InvalidDataException("SSE line too long.");
                line.Append((char)value);
            }
            return line.Length == 0 ? null : line.ToString().TrimEnd('\r');
        }
    }

    internal sealed class KioskView
    {
        internal readonly ServerClock Clock = new ServerClock();
        internal bool Locked, Connected, Scanned;
        internal string RoomCode, RoomName, SessionId = "", Message = "Đang chờ đối soát lịch trực từ máy chủ…";
        internal string DoctorName = "", ShiftName = "", ShiftHours = "", DutyDate = "";
        internal double ExpiresAt, ShiftEndMs;
        internal int QrSeconds = 15, BufferSeconds = 60;
        internal QrCode Qr;
        internal int Remaining { get { return Clock.IsSynchronized ? Math.Max(0, (int)Math.Ceiling((ExpiresAt - Clock.Now) / 1000d)) : 0; } }
        internal void ClearQr() { Qr = null; SessionId = ""; ExpiresAt = 0; Scanned = false; }
        internal bool LeaseExpired { get { return !Locked && ShiftEndMs > 0 && Clock.IsSynchronized && Clock.Now >= ShiftEndMs; } }
        internal void MarkLocked(string message, bool offline)
        {
            Locked = true; ClearQr(); ShiftEndMs = 0; Message = message;
            if (offline) Connected = false;
        }
        internal void MarkReleased(string message, bool offline)
        {
            Locked = false; ClearQr(); ShiftEndMs = 0; Message = message;
            if (offline) Connected = false;
        }
        internal bool ObserveScan(string session, double deadline, int buffer)
        {
            Guid parsed;
            if (!Locked || !Guid.TryParse(session, out parsed) || deadline <= 0 || buffer < 10 || buffer > 300) return false;
            SessionId = session; Scanned = true; Qr = null; ExpiresAt = deadline; BufferSeconds = buffer;
            return true;
        }
        internal bool ApplySnapshot(KioskSnapshot snapshot, double transitMs)
        {
            Clock.Sync(snapshot.ServerTime, transitMs);
            Connected = true; RoomName = snapshot.RoomName; DoctorName = snapshot.DoctorName;
            ShiftName = snapshot.ShiftName; ShiftHours = snapshot.ShiftHours; DutyDate = snapshot.DutyDate;
            if (!snapshot.KioskRequired)
            {
                MarkReleased("Không có ca trực đang diễn ra. Desktop đang được mở.", false);
                return true;
            }
            if (snapshot.IsUnlocked)
            {
                if (snapshot.ShiftEndMs <= Clock.Now) { MarkReleased("Ca trực vừa kết thúc. Desktop đang được mở.", false); return false; }
                ShiftEndMs = snapshot.ShiftEndMs; ClearQr(); Locked = false;
                return true;
            }
            Locked = true;
            // An already observed scan cannot regress to a waiting QR for that same session.
            bool keepScan = Scanned && SessionId == snapshot.SessionId && !snapshot.Scanned;
            if (!keepScan)
            {
                SessionId = snapshot.SessionId; ExpiresAt = snapshot.ExpiresAt;
                Scanned = snapshot.Scanned; Qr = snapshot.Scanned ? null : snapshot.Qr;
            }
            QrSeconds = snapshot.QrSeconds; BufferSeconds = snapshot.BufferSeconds; Message = "";
            return true;
        }
    }

    internal sealed class KioskContext : ApplicationContext
    {
        private readonly KioskConfig config;
        private readonly ApiClient api;
        private readonly Control dispatcher = new Control();
        private readonly List<LockForm> windows = new List<LockForm>();
        private readonly ManualResetEvent stop = new ManualResetEvent(false);
        private readonly AutoResetEvent wake = new AutoResetEvent(false);
        private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
        private readonly KioskView view;
        private readonly KeyboardGuard keyboard;
        private Thread statusThread = null, sseThread = null;
        private volatile bool shuttingDown;
        private long revision;
        private ItDialog itDialog;
        private double nextExpiryRetry;

        internal KioskContext(KioskConfig config)
        {
            this.config = config;
            api = new ApiClient(config);
            view = new KioskView { RoomCode = config.RoomCode, RoomName = "Phòng khám " + config.RoomCode };
#if KIOSK_INPUT_TEST
            // The Windows-only keyboard fixture has no network worker by design; give it a
            // synthetic locked state without changing the production online-first startup policy.
            view.MarkLocked("Kiểm thử bàn phím", false);
#endif
            dispatcher.CreateControl();
            keyboard = new KeyboardGuard(delegate { return view.Locked; }, delegate { return itDialog != null; }, delegate { Post(ShowItDialog); });
            RebuildWindows();
            SystemEvents.DisplaySettingsChanged += DisplayChanged;
            SystemEvents.PowerModeChanged += PowerChanged;
            timer.Interval = 200;
            timer.Tick += Tick;
            timer.Start();
#if !KIOSK_INPUT_TEST
            statusThread = new Thread(StatusLoop) { IsBackground = true, Name = "QLBS state" };
            sseThread = new Thread(EventLoop) { IsBackground = true, Name = "QLBS events" };
            statusThread.Start();
            sseThread.Start();
#endif // Test compilation keeps the production UI/timers/hooks, without network workers.
            Log.Write("Kiosk " + Program.Version + " started; room=" + config.RoomCode);
        }
        private void Post(Action action)
        {
            if (shuttingDown) return;
            try { dispatcher.BeginInvoke((MethodInvoker)delegate { if (!shuttingDown) action(); }); }
            catch (InvalidOperationException) { }
        }
        private void DisplayChanged(object sender, EventArgs args) { Post(RebuildWindows); }
        private void PowerChanged(object sender, PowerModeChangedEventArgs args)
        {
            if (args.Mode == PowerModes.Resume) Post(delegate { Interlocked.Increment(ref revision); Release("Đang đối soát lại ca trực sau khi máy tính hoạt động trở lại…", true); wake.Set(); });
        }
        private void RebuildWindows()
        {
            if (itDialog != null) { ItDialog oldDialog = itDialog; itDialog = null; oldDialog.Close(); }
            foreach (LockForm window in windows) { window.AllowClose = true; window.Dispose(); }
            windows.Clear();
            foreach (Screen screen in Screen.AllScreens)
            {
                LockForm window = new LockForm(view, screen.Primary, ShowItDialog);
                window.Bounds = screen.Bounds;
                windows.Add(window);
                if (view.Locked) window.Show();
            }
        }
        private void Tick(object sender, EventArgs args)
        {
            if (view.LeaseExpired)
            {
                Interlocked.Increment(ref revision);
                Release("Ca trực đã kết thúc. Đang đối soát lại máy chủ…", false);
                wake.Set();
            }
            if (!view.Locked) return; // No foreground activity, tray icon, taskbar item or dock when unlocked.
            if (view.Clock.IsSynchronized && view.ExpiresAt > 0 && view.Clock.Now >= view.ExpiresAt)
            {
                // Never show a locally expired QR even for a single further repaint.
                view.ClearQr();
                view.Message = "Đang cập nhật mã QR mới…";
            }
            if (view.Qr == null && !view.Scanned && view.Clock.IsSynchronized && view.Clock.Now >= nextExpiryRetry)
            {
                nextExpiryRetry = view.Clock.Now + 2000;
                wake.Set();
            }
            foreach (LockForm window in windows) if (!window.IsDisposed)
            {
                // Re-raising the disabled modal owner can cover/deactivate the PIN dialog.
                if (itDialog == null) window.TopMost = true;
                window.Invalidate();
            }
            if (itDialog != null)
            {
                keyboard.RefreshReleasedModifiers();
                itDialog.EnsureInputForeground();
            }
            else
            {
                IntPtr foreground = Native.GetForegroundWindow();
                bool ours = false;
                foreach (LockForm window in windows) if (foreground == window.Handle) ours = true;
                if (!ours && windows.Count > 0) { windows[0].Activate(); Native.SetForegroundWindow(windows[0].Handle); }
            }
        }
        private void Release(string message, bool offline)
        {
            bool changed = view.Locked;
            view.MarkReleased(message, offline);
            if (itDialog != null) itDialog.Close();
            foreach (LockForm window in windows) if (!window.IsDisposed) window.Hide();
            if (changed) Log.Write("Desktop released; awaiting online duty reconciliation.");
        }
        private void Apply(KioskSnapshot snapshot, double transitMs, long expectedRevision)
        {
            if (expectedRevision != revision) { wake.Set(); return; } // Discard a pre-scan/pre-lock in-flight snapshot.
            bool changed = view.Locked;
            if (!view.ApplySnapshot(snapshot, transitMs)) wake.Set();
            if (!view.Locked)
            {
                if (itDialog != null) itDialog.Close();
                foreach (LockForm window in windows) window.Hide();
                if (changed) Log.Write("Desktop released; no HIS auto-launch.");
            }
            else foreach (LockForm window in windows) { if (!window.Visible) window.Show(); window.Invalidate(); }
        }

        private void StatusLoop()
        {
            WaitHandle[] wait = new WaitHandle[] { stop, wake };
            while (!stop.WaitOne(0))
            {
                long expected = Interlocked.Read(ref revision);
                Stopwatch requestTime = Stopwatch.StartNew();
                try
                {
                    KioskSnapshot snapshot = api.Status();
                    double transit = requestTime.Elapsed.TotalMilliseconds / 2;
                    Post(delegate { Apply(snapshot, transit, expected); });
                }
                catch (Exception)
                {
                    Post(delegate { if (expected == revision) Release("Không kết nối được máy chủ; Desktop đang được mở. Đang chờ đối soát lại…", true); });
                }
                if (WaitHandle.WaitAny(wait, 3000) == 0) return;
            }
        }
        private void EventLoop()
        {
            int failures = 0;
            Random jitter = new Random();
            while (!stop.WaitOne(0))
            {
                HttpWebRequest request = null;
                try
                {
                    request = api.Open("/api/kiosk/events/" + Uri.EscapeDataString(config.RoomCode) + "?terminalId=" + Uri.EscapeDataString(config.TerminalId), true);
                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    {
                        if (response.StatusCode != HttpStatusCode.OK || !response.ContentType.StartsWith("text/event-stream", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Invalid event stream.");
                        using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8, true))
                        {
                            SseParser parser = new SseParser();
                            string line;
                            failures = 0;
                            while (!stop.WaitOne(0) && (line = SseParser.ReadLine(reader)) != null)
                                parser.Push(line, delegate(string name, string data) { Post(delegate { OnEvent(name, data); }); });
                        }
                    }
                }
                catch (Exception) { /* Status polling remains authoritative if SSE proxy reconnects. */ }
                finally { if (request != null) { api.Complete(request); request.Abort(); } }
                failures++;
                if (stop.WaitOne(Math.Min(15000, 500 * (1 << Math.Min(failures, 4))) + jitter.Next(0, 400))) return;
            }
        }
        private void OnEvent(string name, string text)
        {
            Dictionary<string, object> data;
            try { data = Json.Decode(text); } catch (Exception) { return; }
            if (!String.Equals(Json.Text(data, "roomCode"), config.RoomCode, StringComparison.OrdinalIgnoreCase)) return;
            string tid = Json.Text(data, "terminalId");
            if (tid.Length > 0 && tid != config.TerminalId) return;
            if (name == "SESSION_SCANNED")
            {
                // Mandatory opaque white overlay is applied on the UI thread before any network refresh.
                if (tid != config.TerminalId || !view.Locked) return;
                string session = Json.Text(data, "sessionId");
                if (!view.ObserveScan(session, Json.Number(data, "expiresAt"), (int)Json.Number(data, "faceVerifyBufferSeconds"))) return;
                Interlocked.Increment(ref revision);
                foreach (LockForm window in windows) { window.Invalidate(); window.Update(); }
                wake.Set();
            }
            else if (name == "LOCK_EVENT")
            {
                Interlocked.Increment(ref revision);
                wake.Set(); // Status response alone may apply a lock after exact online reconciliation.
            }
            else if (name == "UNLOCK_EVENT")
            {
                if (tid != config.TerminalId) return; // Reject room-wide/other-terminal unlocks.
                Interlocked.Increment(ref revision);
                wake.Set(); // Never trust an SSE event alone to release Windows.
            }
            else if (name == "SCHEDULE_UPDATED" || name == "ROSTER_UPDATED" || name == "CONNECTED") wake.Set();
        }
        private void ShowItDialog()
        {
            if (!view.Locked || itDialog != null || windows.Count == 0) return;
            keyboard.RefreshReleasedModifiers();
            ItDialog opened = new ItDialog(api, config, delegate { Interlocked.Increment(ref revision); wake.Set(); });
            itDialog = opened; // Set input mode BEFORE showing the modal window.
            try { opened.ShowDialog(windows[0]); }
            finally { if (itDialog == opened) itDialog = null; opened.Dispose(); keyboard.RefreshReleasedModifiers(); }
        }
        protected override void ExitThreadCore()
        {
            shuttingDown = true;
            timer.Stop();
            stop.Set();
            api.Dispose();
            keyboard.Dispose();
            SystemEvents.DisplaySettingsChanged -= DisplayChanged;
            SystemEvents.PowerModeChanged -= PowerChanged;
            foreach (LockForm window in windows) { window.AllowClose = true; window.Dispose(); }
            base.ExitThreadCore();
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (!shuttingDown) ExitThreadCore();
                if (statusThread != null) statusThread.Join(1000);
                if (sseThread != null) sseThread.Join(1000);
                timer.Dispose();
                dispatcher.Dispose();
                // Workers are background threads; aborted HTTP requests unwind before process exit.
            }
            base.Dispose(disposing);
        }
    }

    internal static class KeyboardPolicy
    {
        internal static bool PermitsPinKey(int key, bool ctrl, bool alt, bool windowsHeld)
        {
            return key != 0x5B && key != 0x5C && key != 0x5D && !alt && !windowsHeld && !(key >= 0x70 && key <= 0x87) &&
                (!ctrl || key == 0x41 || key == 0x11 || key == 0xA2 || key == 0xA3);
        }
    }

    internal sealed class KeyboardGuard : IDisposable
    {
        private IntPtr hook;
        private readonly Native.KeyboardProc callback;
        private readonly Func<bool> locked, pinOpen;
        private readonly Action openPin;
        private readonly HashSet<int> down = new HashSet<int>();
        private readonly HashSet<int> forwardedDown = new HashSet<int>();
        internal KeyboardGuard(Func<bool> locked, Func<bool> pinOpen, Action openPin)
        {
            this.locked = locked; this.pinOpen = pinOpen; this.openPin = openPin;
            callback = Handle;
            hook = Native.SetWindowsHookEx(13, callback, Native.GetModuleHandle(null), 0);
            if (hook == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Không cài được bộ bảo vệ bàn phím. Liên hệ CNTT.");
            // Adopt keys already held before the hook was installed, including their OS key-up.
            for (int key = 8; key < 256; key++)
                if (key != 0x10 && key != 0x11 && key != 0x12 && (Native.GetAsyncKeyState(key) & 0x8000) != 0) { down.Add(key); forwardedDown.Add(key); }
        }
        internal void RefreshReleasedModifiers()
        {
            // Secure desktop/user switching can consume key-up events before this hook sees them.
            // Resync OUTSIDE the hook callback (GetAsyncKeyState is not updated for the current LL event).
            foreach (int key in new int[] { 0x10, 0x11, 0x12, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C })
                if ((Native.GetAsyncKeyState(key) & 0x8000) == 0) down.Remove(key);
        }
        private bool Any(int a, int b, int c) { return down.Contains(a) || down.Contains(b) || down.Contains(c); }
        private IntPtr Handle(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code < 0) return Native.CallNextHookEx(hook, code, wParam, lParam);
            int message = wParam.ToInt32();
            int key = Marshal.ReadInt32(lParam);
            bool keyDown = message == 0x100 || message == 0x104;
            bool keyUp = message == 0x101 || message == 0x105;
            bool repeat = down.Contains(key);
            bool releaseForwardedKey = keyUp && forwardedDown.Remove(key);
            if (keyDown) down.Add(key);
            if (keyUp) down.Remove(key);
            if (!locked())
            {
                if (keyDown) forwardedDown.Add(key);
                return Native.CallNextHookEx(hook, code, wParam, lParam);
            }
            // A key pressed before locking (or while typing a PIN) must get its matching key-up,
            // otherwise Windows can retain a stuck Ctrl/Alt/Win after the desktop is released.
            if (releaseForwardedKey) return Native.CallNextHookEx(hook, code, wParam, lParam);
            bool ctrl = Any(0x11, 0xA2, 0xA3), alt = Any(0x12, 0xA4, 0xA5), shift = Any(0x10, 0xA0, 0xA1);
            if (key == 0x7B && keyDown && !repeat && ctrl && alt && shift) { openPin(); return new IntPtr(1); }
            // WH_KEYBOARD_LL is a user-mode hook, NOT a kernel driver; Windows secure attention remains OS-owned.
            if (pinOpen() && KeyboardPolicy.PermitsPinKey(key, ctrl, alt, down.Contains(0x5B) || down.Contains(0x5C)))
            {
                if (keyDown) forwardedDown.Add(key);
                return Native.CallNextHookEx(hook, code, wParam, lParam);
            }
            return new IntPtr(1);
        }
        public void Dispose() { if (hook != IntPtr.Zero) { Native.UnhookWindowsHookEx(hook); hook = IntPtr.Zero; } }
    }

    internal static class Native
    {
        internal delegate IntPtr KeyboardProc(int code, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll", SetLastError = true)] internal static extern IntPtr SetWindowsHookEx(int id, KeyboardProc proc, IntPtr module, uint threadId);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool UnhookWindowsHookEx(IntPtr hook);
        [DllImport("user32.dll")] internal static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)] internal static extern IntPtr GetModuleHandle(string name);
        [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
        [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetForegroundWindow(IntPtr handle);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetProcessDPIAware();
    }

    internal static class KioskArt
    {
        internal static readonly Color Navy = Color.FromArgb(10, 23, 37), Panel = Color.FromArgb(16, 36, 51), Teal = Color.FromArgb(53, 215, 185), Muted = Color.FromArgb(153, 176, 188);
        internal static void Text(Graphics g, string text, float size, FontStyle style, Color color, RectangleF box, StringAlignment align)
        {
            using (Font font = new Font("Segoe UI", size, style, GraphicsUnit.Pixel))
            using (Brush brush = new SolidBrush(color))
            using (StringFormat format = new StringFormat { Alignment = align, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter })
                g.DrawString(text, font, brush, box, format);
        }
        internal static void Round(Graphics g, RectangleF box, float radius, Color fill, Color border)
        {
            using (GraphicsPath path = new GraphicsPath())
            {
                float d = radius * 2;
                path.AddArc(box.X, box.Y, d, d, 180, 90); path.AddArc(box.Right - d, box.Y, d, d, 270, 90);
                path.AddArc(box.Right - d, box.Bottom - d, d, d, 0, 90); path.AddArc(box.X, box.Bottom - d, d, d, 90, 90); path.CloseFigure();
                using (Brush brush = new SolidBrush(fill)) g.FillPath(brush, path);
                if (border.A > 0) using (Pen pen = new Pen(border, 1)) g.DrawPath(pen, path);
            }
        }
        internal static void Shield(Graphics g, float x, float y, float size, Color color)
        {
            using (Pen pen = new Pen(color, size / 15))
            {
                g.DrawPolygon(pen, new PointF[] { new PointF(x + size / 2, y), new PointF(x + size, y + size / 5), new PointF(x + size * .88f, y + size * .68f), new PointF(x + size / 2, y + size), new PointF(x + size * .12f, y + size * .68f), new PointF(x, y + size / 5) });
                g.DrawLine(pen, x + size * .32f, y + size * .49f, x + size * .46f, y + size * .64f);
                g.DrawLine(pen, x + size * .46f, y + size * .64f, x + size * .72f, y + size * .35f);
            }
        }
        internal static void Qr(Graphics g, QrCode qr, RectangleF box)
        {
            if (qr == null) return;
            // Integer DEVICE pixels and a four-module quiet zone; no resampling blur at 125/150% DPI.
            PointF[] points = new PointF[] { new PointF(box.X, box.Y), new PointF(box.Right, box.Bottom) };
            using (Matrix transform = g.Transform) transform.TransformPoints(points);
            GraphicsState state = g.Save();
            g.ResetTransform();
            g.SmoothingMode = SmoothingMode.None;
            int scale = Math.Max(1, (int)Math.Min(points[1].X - points[0].X, points[1].Y - points[0].Y) / (qr.Size + 8));
            int dim = scale * (qr.Size + 8);
            int x = (int)(points[0].X + (points[1].X - points[0].X - dim) / 2), y = (int)(points[0].Y + (points[1].Y - points[0].Y - dim) / 2);
            g.FillRectangle(Brushes.White, x, y, dim, dim);
            using (Brush ink = new SolidBrush(Color.FromArgb(13, 52, 57)))
                for (int row = 0; row < qr.Size; row++) for (int col = 0; col < qr.Size; col++)
                    if (qr.GetModule(col, row)) g.FillRectangle(ink, x + (col + 4) * scale, y + (row + 4) * scale, scale, scale);
            g.Restore(state);
        }
    }

    internal sealed class LockForm : Form
    {
        private readonly KioskView view;
                private readonly Action support;
        internal bool AllowClose;
        private int logoClicks;
        private long lastLogoClick;
        internal LockForm(KioskView view, bool primary, Action support)
        {
            this.view = view; this.support = support;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = true;
            BackColor = KioskArt.Navy;
            Text = "QLBS Kiosk — " + view.RoomCode;
            DoubleBuffered = true;
            AutoScaleMode = AutoScaleMode.None;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
        }
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!AllowClose && e.CloseReason == CloseReason.UserClosing) e.Cancel = true;
            base.OnFormClosing(e);
        }
        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            float scale = Math.Min(ClientSize.Width / 1366f, ClientSize.Height / 768f);
            float x = (e.X - (ClientSize.Width - 1366 * scale) / 2) / scale;
            float y = (e.Y - (ClientSize.Height - 768 * scale) / 2) / scale;
            if (x >= 1150 && x <= 1286 && y >= 34 && y <= 74) support();
            if (x >= 72 && x <= 430 && y >= 30 && y <= 95)
            {
                long now = Stopwatch.GetTimestamp();
                if ((now - lastLogoClick) / (double)Stopwatch.Frequency > 2) logoClicks = 0;
                lastLogoClick = now;
                if (++logoClicks >= 5) { logoClicks = 0; support(); }
            }
        }
        private static string FormatDate(string value)
        {
            DateTime date;
            return DateTime.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date) ? date.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture) : value;
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            float scale = Math.Min(ClientSize.Width / 1366f, ClientSize.Height / 768f);
            g.TranslateTransform((ClientSize.Width - 1366 * scale) / 2, (ClientSize.Height - 768 * scale) / 2);
            g.ScaleTransform(scale, scale);
            using (Brush glow = new LinearGradientBrush(new Rectangle(0, 0, 1366, 768), Color.FromArgb(13, 37, 49), KioskArt.Navy, 30f)) g.FillRectangle(glow, 0, 0, 1366, 768);
            using (Pen grid = new Pen(Color.FromArgb(15, 115, 151, 162)))
            {
                for (int x = 800; x < 1366; x += 48) g.DrawLine(grid, x, 100, x, 690);
                for (int y = 110; y < 690; y += 48) g.DrawLine(grid, 790, y, 1366, y);
            }
            KioskArt.Shield(g, 80, 40, 37, KioskArt.Teal);
            KioskArt.Text(g, "BỆNH VIỆN QUÂN Y 4", 19, FontStyle.Bold, Color.White, new RectangleF(134, 31, 380, 30), StringAlignment.Near);
            KioskArt.Text(g, "XÁC THỰC CA TRỰC  /  QLBS KIOSK", 11, FontStyle.Regular, KioskArt.Muted, new RectangleF(134, 61, 380, 20), StringAlignment.Near);
            KioskArt.Round(g, new RectangleF(1148, 36, 138, 38), 12, Color.FromArgb(17, 41, 55), Color.FromArgb(40, 69, 82));
            KioskArt.Text(g, "Hỗ trợ CNTT", 13, FontStyle.Regular, Color.FromArgb(210, 227, 231), new RectangleF(1150, 36, 134, 38), StringAlignment.Center);
            string clock = view.Clock.IsSynchronized ? view.Clock.BangkokNow.ToString("HH:mm:ss", CultureInfo.InvariantCulture) : "--:--:--";
            string date = view.Clock.IsSynchronized ? view.Clock.BangkokNow.ToString("dddd, dd/MM/yyyy", CultureInfo.GetCultureInfo("vi-VN")) : "Đang đồng bộ giờ máy chủ";
            KioskArt.Text(g, clock, 25, FontStyle.Bold, Color.White, new RectangleF(890, 30, 228, 31), StringAlignment.Far);
            KioskArt.Text(g, date, 11, FontStyle.Regular, KioskArt.Muted, new RectangleF(840, 63, 278, 20), StringAlignment.Far);
            KioskArt.Round(g, new RectangleF(80, 142, 350, 34), 16, Color.FromArgb(17, 59, 62), Color.Transparent);
            KioskArt.Text(g, "MÁY TRẠM ĐƯỢC BẢO VỆ  ·  " + view.RoomCode, 11, FontStyle.Bold, KioskArt.Teal, new RectangleF(96, 142, 320, 34), StringAlignment.Near);
            KioskArt.Text(g, "Xác thực để", 48, FontStyle.Bold, Color.White, new RectangleF(76, 194, 700, 65), StringAlignment.Near);
            KioskArt.Text(g, "bắt đầu ca khám.", 48, FontStyle.Bold, KioskArt.Teal, new RectangleF(76, 253, 710, 65), StringAlignment.Near);
            KioskArt.Text(g, "Hệ thống xác thực khuôn mặt và tự động đối soát với bảng phân công ca trực của bệnh viện", 17, FontStyle.Regular, KioskArt.Muted, new RectangleF(80, 329, 625, 62), StringAlignment.Near);
            KioskArt.Round(g, new RectangleF(80, 414, 650, 156), 18, KioskArt.Panel, Color.FromArgb(37, 66, 80));
            KioskArt.Text(g, "BÁC SĨ THEO LỊCH PHÂN CÔNG", 11, FontStyle.Bold, KioskArt.Muted, new RectangleF(105, 433, 590, 23), StringAlignment.Near);
            KioskArt.Text(g, !view.Connected ? "Đang đồng bộ lịch trực" : view.DoctorName.Length > 0 ? view.DoctorName : "Chưa có phân công ca trực", 24, FontStyle.Bold, Color.White, new RectangleF(104, 464, 592, 34), StringAlignment.Near);
            KioskArt.Text(g, !view.Connected ? "Thông tin sẽ cập nhật khi kết nối máy chủ" : view.DoctorName.Length > 0 ? view.ShiftName + "   •   " + view.ShiftHours + "   •   " + FormatDate(view.DutyDate) : "Chỉ lịch đã công bố được dùng để xác thực", 14, FontStyle.Regular, KioskArt.Teal, new RectangleF(105, 506, 593, 24), StringAlignment.Near);
            KioskArt.Text(g, view.RoomName, 12, FontStyle.Regular, KioskArt.Muted, new RectangleF(105, 535, 593, 20), StringAlignment.Near);
            KioskArt.Round(g, new RectangleF(812, 135, 474, 458), 24, Color.FromArgb(245, 250, 250), Color.Transparent);
            Color ink = Color.FromArgb(16, 56, 63);
            KioskArt.Text(g, view.Scanned ? "XÁC THỰC KHUÔN MẶT" : "QUÉT MÃ BẰNG CAMERA ĐIỆN THOẠI", 13, FontStyle.Bold, ink, new RectangleF(835, 150, 428, 37), StringAlignment.Center);
            RectangleF qrBox = new RectangleF(904, 200, 290, 290);
            // The QR is never drawn underneath an overlay: SCANNED removes it from the render tree entirely.
            g.FillRectangle(Brushes.White, qrBox);
            if (view.Connected && view.Scanned && view.Remaining > 0)
            {
                using (Pen pen = new Pen(Color.FromArgb(206, 235, 230), 7)) g.DrawEllipse(pen, 980, 235, 138, 138);
                using (Pen pen = new Pen(Color.FromArgb(15, 138, 118), 7)) g.DrawArc(pen, 980, 235, 138, 138, -90, 360f * Math.Min(1, view.Remaining / (float)view.BufferSeconds));
                KioskArt.Text(g, view.Remaining.ToString(CultureInfo.InvariantCulture) + "s", 43, FontStyle.Bold, ink, new RectangleF(980, 245, 138, 116), StringAlignment.Center);
                KioskArt.Text(g, "Đang xác thực", 22, FontStyle.Bold, ink, new RectangleF(910, 393, 278, 35), StringAlignment.Center);
                KioskArt.Text(g, "Nhìn thẳng camera điện thoại", 14, FontStyle.Regular, Color.FromArgb(86, 115, 120), new RectangleF(910, 435, 278, 27), StringAlignment.Center);
            }
            else if (view.Connected && view.Qr != null && view.Remaining > 0) KioskArt.Qr(g, view.Qr, qrBox);
            else
            {
                KioskArt.Shield(g, 1020, 263, 57, Color.FromArgb(42, 139, 127));
                KioskArt.Text(g, "Đang kết nối an toàn", 22, FontStyle.Bold, ink, new RectangleF(850, 354, 398, 40), StringAlignment.Center);
                KioskArt.Text(g, view.Message.Length > 0 ? view.Message : "Đang đồng bộ phiên QR…", 13, FontStyle.Regular, Color.FromArgb(93, 118, 124), new RectangleF(850, 399, 398, 72), StringAlignment.Center);
            }
            string qrLabel = view.Scanned ? "Vui lòng hoàn tất trên điện thoại" : view.Connected && view.Qr != null && view.Remaining > 0 ? "Tự đổi mã sau " + view.Remaining + " giây" : "Tự khôi phục khi mạng sẵn sàng";
            KioskArt.Round(g, new RectangleF(859, 509, 380, 36), 17, Color.FromArgb(225, 242, 238), Color.Transparent);
            KioskArt.Text(g, qrLabel, 14, FontStyle.Bold, Color.FromArgb(16, 113, 98), new RectangleF(865, 509, 368, 36), StringAlignment.Center);
            string[] steps = new string[] { "Quét mã QR bằng điện thoại", "Nhìn thẳng camera điện thoại để xác thực", "Mở khóa màn hình thành công" };
            for (int i = 0; i < 3; i++)
            {
                float x = 80 + i * 427;
                bool active = i == (view.Scanned ? 1 : 0);
                KioskArt.Round(g, new RectangleF(x, 637, 34, 34), 16, active ? KioskArt.Teal : Color.FromArgb(29, 48, 63), Color.Transparent);
                KioskArt.Text(g, (i + 1).ToString(CultureInfo.InvariantCulture), 15, FontStyle.Bold, active ? KioskArt.Navy : KioskArt.Muted, new RectangleF(x, 637, 34, 34), StringAlignment.Center);
                KioskArt.Text(g, steps[i], 13, active ? FontStyle.Bold : FontStyle.Regular, active ? Color.White : KioskArt.Muted, new RectangleF(x + 46, 631, i == 1 ? 284 : 276, 47), StringAlignment.Near);
                if (i < 2) KioskArt.Text(g, "→", 26, FontStyle.Regular, Color.FromArgb(89, 133, 144), new RectangleF(x + 368, 631, 42, 46), StringAlignment.Center);
            }
            using (Pen line = new Pen(Color.FromArgb(32, 61, 74))) g.DrawLine(line, 80, 708, 1286, 708);
            KioskArt.Text(g, "Bệnh viện quân y 4", 13, FontStyle.Regular, KioskArt.Muted, new RectangleF(80, 722, 1206, 25), StringAlignment.Center);
        }
    }

    internal sealed class ItDialog : Form
    {
        private readonly ApiClient api;
        private readonly KioskConfig config;
        private readonly Action accepted;
        private readonly TextBox pin = new TextBox();
        private readonly Label error = new Label();
        private readonly Button submit = new Button();
        private bool busy;
        internal ItDialog(ApiClient api, KioskConfig config, Action accepted)
        {
            this.api = api; this.config = config; this.accepted = accepted;
            Text = "Xác thực kỹ thuật viên CNTT";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterParent;
            ShowInTaskbar = false; MaximizeBox = false; MinimizeBox = false; TopMost = true;
            ClientSize = new Size(466, 306); BackColor = Color.White;
            Font = new Font("Segoe UI", 10);
            Controls.Add(new Label { Text = "Mở khóa hỗ trợ kỹ thuật", Font = new Font("Segoe UI", 16, FontStyle.Bold), Location = new Point(28, 23), Size = new Size(416, 34) });
            Controls.Add(new Label { Text = "Nhập Master PIN được quản trị viên cấu hình trên QLBV.\nYêu cầu được xác minh trực tuyến và ghi nhật ký.", Location = new Point(28, 67), Size = new Size(406, 49), ForeColor = Color.DimGray });
            pin.Location = new Point(28, 127); pin.Size = new Size(406, 30); pin.UseSystemPasswordChar = true; pin.MaxLength = 128;
            Controls.Add(pin);
            error.Location = new Point(28, 168); error.Size = new Size(406, 58); error.ForeColor = Color.Firebrick; Controls.Add(error);
            Button cancel = new Button { Text = "Đóng", Location = new Point(221, 246), Size = new Size(95, 36), DialogResult = DialogResult.Cancel };
            submit.Text = "Xác minh PIN"; submit.Location = new Point(328, 246); submit.Size = new Size(106, 36); submit.BackColor = Color.FromArgb(16, 124, 108); submit.ForeColor = Color.White; submit.FlatStyle = FlatStyle.Flat;
            Controls.Add(cancel); Controls.Add(submit); CancelButton = cancel; AcceptButton = submit;
            submit.Click += Verify;
            ActiveControl = pin;
            Shown += delegate { BeginInvoke((MethodInvoker)delegate { if (!IsDisposed) { Activate(); pin.Select(); pin.Focus(); } }); };
        }
        internal void EnsureInputForeground()
        {
            if (IsDisposed || !Visible || !IsHandleCreated) return;
            if (Native.GetForegroundWindow() != Handle)
            {
                TopMost = true; Activate(); Native.SetForegroundWindow(Handle);
                if (!busy) { ActiveControl = pin; pin.Focus(); }
            }
        }
        private void Verify(object sender, EventArgs args)
        {
            if (busy || pin.Text.Trim().Length == 0) return;
            busy = true; submit.Enabled = false; error.Text = "Đang xác minh…";
            string entered = pin.Text; pin.Clear();
            ThreadPool.QueueUserWorkItem(delegate
            {
                string failure = null;
                try
                {
                    Dictionary<string, object> result = api.Read("/api/kiosk/override-pin", new { roomCode = config.RoomCode, terminalId = config.TerminalId, pin = entered, reason = "Hỗ trợ từ hộp thoại CNTT máy trạm" });
                    if (!Json.Flag(result, "success")) throw new InvalidDataException("Máy chủ chưa xác nhận mở khóa.");
                }
                catch (Exception ex) { failure = ex.Message; }
                entered = null;
                try
                {
                    if (IsDisposed || !IsHandleCreated) return;
                    BeginInvoke((MethodInvoker)delegate
                    {
                        if (IsDisposed) return;
                        busy = false; submit.Enabled = true;
                        if (failure == null) { accepted(); Close(); }
                        else { error.Text = failure; pin.Focus(); }
                    });
                }
                catch (InvalidOperationException) { }
            });
        }
    }

    internal sealed class SetupForm : Form
    {
        private readonly TextBox server = new TextBox(), room = new TextBox();
        private readonly Label status = new Label();
        private readonly Button install = new Button(), test = new Button();
        private bool busy;
        internal SetupForm()
        {
            Text = "QLBS Kiosk • Thiết lập máy trạm";
            FormClosing += delegate(object sender, FormClosingEventArgs args)
            {
                if (busy && args.CloseReason == CloseReason.UserClosing)
                {
                    args.Cancel = true;
                    status.Text = "Đang kiểm tra/cài đặt. Vui lòng chờ hoàn tất để tránh gián đoạn cấu hình máy trạm.";
                }
            };
            ClientSize = new Size(590, 492); StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; BackColor = Color.White; Font = new Font("Segoe UI", 10);
            Controls.Add(new Label { Text = "Thiết lập phòng khám", Font = new Font("Segoe UI", 23, FontStyle.Bold), Location = new Point(34, 26), Size = new Size(520, 48) });
            Controls.Add(new Label { Text = "Một ứng dụng. Không Edge, không WebView, không DLL ngoài.\nMã máy trạm được tạo tự động và giữ nguyên khi cài lại.", Location = new Point(37, 83), Size = new Size(520, 49), ForeColor = Color.DimGray });
            Controls.Add(new Label { Text = "Địa chỉ máy chủ QLBV", Location = new Point(37, 151), Size = new Size(510, 25) });
            server.Location = new Point(38, 180); server.Size = new Size(513, 30); server.MaxLength = 250; server.Text = "https://"; Controls.Add(server);
            Controls.Add(new Label { Text = "Mã phòng khám (đúng mã trong danh mục QLBV)", Location = new Point(37, 229), Size = new Size(510, 25) });
            room.Location = new Point(38, 259); room.Size = new Size(513, 30); room.MaxLength = 64; room.CharacterCasing = CharacterCasing.Upper; Controls.Add(room);
            status.Location = new Point(37, 310); status.Size = new Size(514, 90); status.ForeColor = Color.DimGray; status.Text = "Khuyến nghị HTTPS với chứng chỉ được Windows và điện thoại tin cậy.\nThiết lập chỉ lưu khi kiểm tra đúng máy chủ và đúng mã phòng thành công."; Controls.Add(status);
            test.Text = "Kiểm tra kết nối"; test.Location = new Point(38, 420); test.Size = new Size(183, 41); test.Click += delegate { ValidateServer(false); }; Controls.Add(test);
            install.Text = "Cài đặt máy trạm"; install.Location = new Point(330, 420); install.Size = new Size(222, 41); install.BackColor = Color.FromArgb(16, 124, 108); install.ForeColor = Color.White; install.FlatStyle = FlatStyle.Flat; install.Click += delegate { ValidateServer(true); }; Controls.Add(install);
            AcceptButton = install;
            try { KioskConfig old = KioskConfig.Load(Program.ConfigPath); server.Text = old.ServerUrl; room.Text = old.RoomCode; }
            catch (Exception)
            {
                try { KioskConfig old = KioskConfig.Load(Path.Combine(Program.LegacyDirectory, "config.ini")); server.Text = old.ServerUrl; room.Text = old.RoomCode; } catch (Exception) { }
            }
        }
        private void ValidateServer(bool doInstall)
        {
            if (busy) return;
            KioskConfig config;
            try { config = KioskConfig.ForInstall(server.Text, room.Text); }
            catch (Exception ex) { status.ForeColor = Color.Firebrick; status.Text = ex.Message; return; }
            busy = true; test.Enabled = false; install.Enabled = false; status.ForeColor = Color.DimGray; status.Text = "Đang kiểm tra máy chủ, giao thức và mã phòng…";
            ThreadPool.QueueUserWorkItem(delegate
            {
                string failure = null, name = null;
                try { using (ApiClient api = new ApiClient(config)) name = api.Preflight().RoomName; }
                catch (Exception ex) { failure = ex.Message; }
                try
                {
                    if (IsDisposed) return;
                    BeginInvoke((MethodInvoker)delegate
                    {
                        if (IsDisposed) return;
                        busy = false; test.Enabled = true; install.Enabled = true;
                        if (failure != null) { status.ForeColor = Color.Firebrick; status.Text = failure; return; }
                        status.ForeColor = Color.FromArgb(13, 116, 97); status.Text = "Kết nối hợp lệ: " + name + "\n" + (config.ServerUrl.StartsWith("https:") ? "HTTPS được Windows tin cậy." : "Lưu ý: HTTP chỉ dùng trong LAN tin cậy; camera web tự động cần HTTPS.");
                        if (!doInstall) return;
                        if (!Installer.IsAdmin())
                        {
                            try
                            {
                                ProcessStartInfo start = new ProcessStartInfo(Application.ExecutablePath, "/install /server " + Installer.Quote(config.ServerUrl) + " /room " + Installer.Quote(config.RoomCode));
                                start.UseShellExecute = true; start.Verb = "runas"; Process.Start(start); Close();
                            }
                            catch (Win32Exception) { status.ForeColor = Color.Firebrick; status.Text = "Chưa cấp quyền Administrator. Chưa thay đổi cấu hình máy trạm."; }
                        }
                        else
                        {
                            busy = true; test.Enabled = false; install.Enabled = false; status.Text = "Đang cài đặt và chuyển đổi cấu hình máy trạm…";
                            ThreadPool.QueueUserWorkItem(delegate
                            {
                                string installFailure = null;
                                try { Installer.Install(config, true); } catch (Exception ex) { installFailure = ex.Message; }
                                try
                                {
                                    if (IsDisposed) return;
                                    BeginInvoke((MethodInvoker)delegate
                                    {
                                        if (IsDisposed) return;
                                        busy = false; test.Enabled = true; install.Enabled = true;
                                        if (installFailure == null) Close();
                                        else { status.ForeColor = Color.Firebrick; status.Text = installFailure; }
                                    });
                                }
                                catch (InvalidOperationException) { }
                            });
                        }
                    });
                }
                catch (InvalidOperationException) { }
            });
        }
    }

    internal static class Installer
    {
        private const string RunKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
        private const string UninstallKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QLBS_Kiosk";
        internal static bool IsAdmin() { using (WindowsIdentity identity = WindowsIdentity.GetCurrent()) return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator); }
        internal static string Quote(string value) { return "\"" + value.Replace("\"", "") + "\""; }
        internal static int InstallFromOptions(Options options)
        {
            if (!options.Has("server") || !options.Has("room")) throw new ArgumentException("Dùng /install /server https://qlbv.benhvien.vn /room PK01 [/quiet /no-start].");
            if (!IsAdmin())
            {
                if (options.Has("quiet")) throw new UnauthorizedAccessException("Triển khai im lặng cần quyền Administrator hoặc SYSTEM.");
                ProcessStartInfo info = new ProcessStartInfo(Application.ExecutablePath, "/install /server " + Quote(options.Get("server")) + " /room " + Quote(options.Get("room")) + (options.Has("no-start") ? " /no-start" : ""));
                info.Verb = "runas"; info.UseShellExecute = true;
                using (Process child = Process.Start(info)) { child.WaitForExit(); return child.ExitCode; }
            }
            KioskConfig config = KioskConfig.ForInstall(options.Get("server"), options.Get("room"));
            // Preflight happens before stopping any existing kiosk or changing a single startup entry.
            using (ApiClient api = new ApiClient(config)) api.Preflight();
            bool launch = !options.Has("no-start") && !options.Has("quiet") && Process.GetCurrentProcess().SessionId != 0;
            Install(config, launch);
            if (!options.Has("quiet")) MessageBox.Show("Đã cài QLBS Kiosk cho " + config.RoomCode + ".\nKiosk áp dụng cho mọi tài khoản Windows, kể cả Administrators. Chỉ khi máy chủ xác nhận ca đang diễn ra thì Kiosk mới khóa; mất kết nối hoặc không có ca thì Desktop được mở.\n\n" + (launch ? "Máy trạm đang khởi động qua Windows Explorer." : "Ứng dụng sẽ chạy ở lần đăng nhập tiếp theo."), "QLBS Kiosk", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        internal static void Install(KioskConfig config, bool launch)
        {
            bool acquired;
            using (Mutex setup = new Mutex(true, @"Global\QLBS_Kiosk_Setup_v2", out acquired))
            {
                if (!acquired) throw new InvalidOperationException("Một phiên cài đặt khác đang chạy. Vui lòng chờ hoàn tất.");
                try { InstallCore(config, launch); }
                finally { setup.ReleaseMutex(); }
            }
        }
        private static void InstallCore(KioskConfig config, bool launch)
        {
            if (!IsAdmin()) throw new UnauthorizedAccessException("Cài đặt cần quyền Administrator.");
            config.Validate();
            string target = Path.Combine(Program.InstallDirectory, "QLBS_Kiosk.exe");
            Directory.CreateDirectory(Program.InstallDirectory); Directory.CreateDirectory(Program.DataDirectory);
            ProtectDataDirectory();
            // Cancel a prior deferred uninstall before touching the new installation.
            foreach (string marker in Directory.GetFiles(Program.InstallDirectory, ".uninstall-*.pending")) File.Delete(marker);
            bool sameFile = String.Equals(Path.GetFullPath(Application.ExecutablePath), Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase);
            string oldConfig = File.Exists(Program.ConfigPath) ? File.ReadAllText(Program.ConfigPath, Encoding.UTF8) : null;
            bool hadExe = File.Exists(target);
            string legacyExe = Path.Combine(Program.LegacyDirectory, "QLBS_Kiosk_Agent.exe");
            bool hadLegacy = File.Exists(legacyExe);
            string oldRun;
            using (RegistryKey key = Registry.LocalMachine.CreateSubKey(RunKey)) oldRun = key.GetValue("QLBS_Kiosk") as string;
            Dictionary<string, object> oldUninstall = null;
            Dictionary<string, RegistryValueKind> oldKinds = new Dictionary<string, RegistryValueKind>();
            using (RegistryKey key = Registry.LocalMachine.OpenSubKey(UninstallKey))
            {
                if (key != null)
                {
                    oldUninstall = new Dictionary<string, object>();
                    foreach (string name in key.GetValueNames())
                    {
                        oldUninstall[name] = key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
                        oldKinds[name] = key.GetValueKind(name);
                    }
                }
            }
            string[] legacyRuns = new string[2];
            RegistryKey[] legacyRoots = new RegistryKey[] { Registry.LocalMachine, Registry.CurrentUser };
            for (int i = 0; i < legacyRoots.Length; i++)
                using (RegistryKey key = legacyRoots[i].OpenSubKey(RunKey)) if (key != null) legacyRuns[i] = key.GetValue("QLBS_Kiosk_Agent") as string;
            string backup = target + ".previous", staging = target + ".new";
            string configStaging = Path.Combine(Program.DataDirectory, "config-" + Guid.NewGuid().ToString("N") + ".new");
            bool stopped = false, replaced = false, configWritten = false;
            try
            {
                if (!sameFile) File.Copy(Application.ExecutablePath, staging, true);
                using (StreamWriter writer = new StreamWriter(new FileStream(configStaging, FileMode.CreateNew, FileAccess.Write, FileShare.None), new UTF8Encoding(false))) writer.Write(config.Serialize());
                stopped = true; StopOwnedProcesses();
                if (!sameFile)
                {
                    if (File.Exists(backup)) File.Delete(backup);
                    if (hadExe) File.Replace(staging, target, backup); else File.Move(staging, target);
                    replaced = true;
                }
                if (File.Exists(Program.ConfigPath)) File.Replace(configStaging, Program.ConfigPath, null);
                else File.Move(configStaging, Program.ConfigPath);
                configWritten = true;
                ProtectConfigFile();
                // One all-user autorun; daily execution uses the logged-in user's standard token, not a scheduled admin task.
                using (RegistryKey key = Registry.LocalMachine.CreateSubKey(RunKey)) key.SetValue("QLBS_Kiosk", Quote(target), RegistryValueKind.String);
                RegisterUninstall(target);
                CleanupLegacy();
                try { if (File.Exists(backup)) File.Delete(backup); }
                catch (IOException) { Log.Write("Previous binary retained for IT cleanup."); }
                catch (UnauthorizedAccessException) { Log.Write("Previous binary retained; IT should check its ACL."); }
                Log.Write("Installation committed; room=" + config.RoomCode);
            }
            catch
            {
                try
                {
                    if (replaced && File.Exists(backup)) File.Copy(backup, target, true);
                    else if (replaced && !hadExe && File.Exists(target)) File.Delete(target);
                    if (configWritten)
                    {
                        if (oldConfig != null) { File.WriteAllText(Program.ConfigPath, oldConfig, new UTF8Encoding(false)); ProtectConfigFile(); }
                        else if (File.Exists(Program.ConfigPath)) File.Delete(Program.ConfigPath);
                    }
                    using (RegistryKey key = Registry.LocalMachine.CreateSubKey(RunKey)) { if (oldRun == null) key.DeleteValue("QLBS_Kiosk", false); else key.SetValue("QLBS_Kiosk", oldRun); }
                    if (oldUninstall == null) Registry.LocalMachine.DeleteSubKeyTree(UninstallKey, false);
                    else using (RegistryKey key = Registry.LocalMachine.CreateSubKey(UninstallKey))
                    {
                        foreach (string name in key.GetValueNames()) key.DeleteValue(name, false);
                        foreach (KeyValuePair<string, object> pair in oldUninstall) key.SetValue(pair.Key, pair.Value, oldKinds[pair.Key]);
                    }
                    for (int i = 0; i < legacyRoots.Length; i++)
                        if (legacyRuns[i] != null) using (RegistryKey key = legacyRoots[i].CreateSubKey(RunKey)) key.SetValue("QLBS_Kiosk_Agent", legacyRuns[i]);
                    if (stopped && hadExe) LaunchViaExplorer(target);
                    else if (stopped && hadLegacy && File.Exists(legacyExe)) LaunchViaExplorer(legacyExe);
                }
                catch (Exception ex) { Log.Write("Rollback needs IT review: " + ex.GetType().Name); }
                throw;
            }
            finally { try { if (File.Exists(staging)) File.Delete(staging); if (File.Exists(configStaging)) File.Delete(configStaging); } catch (Exception) { } }
            try
            {
                string oldAgent = Path.Combine(Program.LegacyDirectory, "QLBS_Kiosk_Agent.exe");
                if (File.Exists(oldAgent))
                {
                    string retired = oldAgent + ".retired";
                    if (File.Exists(retired)) File.Delete(retired);
                    File.Move(oldAgent, retired);
                }
            }
            catch (IOException) { Log.Write("Old agent binary retained; startup entries have been removed."); }
            catch (UnauthorizedAccessException) { Log.Write("Old agent binary could not be retired; IT should check its ACL."); }
            if (launch) LaunchViaExplorer(target);
        }
        private static void ProtectDataDirectory()
        {
            foreach (string directory in new string[] { Path.GetDirectoryName(Program.DataDirectory), Program.DataDirectory, Program.InstallDirectory })
            {
                if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("Thư mục cài đặt/cấu hình đang chuyển hướng. CNTT cần kiểm tra trước khi cài.");
                DirectorySecurity security = new DirectorySecurity();
                security.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));
                security.SetAccessRuleProtection(true, false);
                InheritanceFlags inherit = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
                security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), FileSystemRights.FullControl, inherit, PropagationFlags.None, AccessControlType.Allow));
                security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), FileSystemRights.FullControl, inherit, PropagationFlags.None, AccessControlType.Allow));
                security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null), FileSystemRights.ReadAndExecute, inherit, PropagationFlags.None, AccessControlType.Allow));
                Directory.SetAccessControl(directory, security);
            }
        }
        private static void ProtectConfigFile()
        {
            FileSecurity security = new FileSecurity();
            security.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));
            security.SetAccessRuleProtection(true, false);
            security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), FileSystemRights.FullControl, AccessControlType.Allow));
            security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), FileSystemRights.FullControl, AccessControlType.Allow));
            security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null), FileSystemRights.Read, AccessControlType.Allow));
            File.SetAccessControl(Program.ConfigPath, security);
        }
        private static void RegisterUninstall(string target)
        {
            using (RegistryKey key = Registry.LocalMachine.CreateSubKey(UninstallKey))
            {
                key.SetValue("DisplayName", "QLBS Kiosk — Bệnh viện quân y 4"); key.SetValue("DisplayVersion", Program.Version); key.SetValue("Publisher", "Bệnh viện quân y 4");
                key.SetValue("InstallLocation", Program.InstallDirectory); key.SetValue("UninstallString", Quote(target) + " /uninstall");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord); key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }
        private static void LaunchViaExplorer(string target)
        {
            // Delegate to the existing interactive shell: do not keep the kiosk elevated after UAC setup.
            ProcessStartInfo info = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"), Quote(target));
            info.UseShellExecute = true;
            try { Process.Start(info); }
            catch (Win32Exception) { Log.Write("Shell launch unavailable; installation is saved. Sign out/in to start with the user token."); }
        }
        private static void StopOwnedProcesses()
        {
            foreach (string name in new string[] { "QLBS_Kiosk", "QLBS_Kiosk_Agent" })
            foreach (Process process in Process.GetProcessesByName(name))
            {
                using (process)
                {
                    if (process.Id == Process.GetCurrentProcess().Id) continue;
                    try
                    {
                        if (process.HasExited) continue;
                        string path = process.MainModule.FileName;
                        if (IsInside(path, Program.InstallDirectory) || IsInside(path, Program.LegacyDirectory))
                        {
                            process.Kill();
                            if (!process.WaitForExit(5000)) throw new IOException("Không dừng được phiên Kiosk cũ; chưa thay đổi cài đặt.");
                        }
                    }
                    catch (InvalidOperationException) { if (!process.HasExited) throw; }
                    catch (Win32Exception)
                    {
                        if (!process.HasExited) throw new IOException("Không kiểm tra/dừng được tiến trình Kiosk cũ. CNTT cần kiểm tra quyền trước khi thay đổi cài đặt.");
                    }
                }
            }
        }
        private static bool IsInside(string path, string root) { return Path.GetFullPath(path).StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase); }
        private static void DeleteValue(RegistryKey root, string keyPath, string value)
        {
            using (RegistryKey key = root.OpenSubKey(keyPath, true)) if (key != null) key.DeleteValue(value, false);
        }
        internal static void CleanupLegacy()
        {
            // Do not touch a fresh machine's enterprise Task Manager/browser policies.
            string migrationFlag = Path.Combine(Program.DataDirectory, "legacy-migrated.flag");
            bool legacy = File.Exists(Path.Combine(Program.LegacyDirectory, "QLBS_Kiosk_Agent.exe")) ||
                (!File.Exists(migrationFlag) && File.Exists(Path.Combine(Program.LegacyDirectory, "config.ini")));
            foreach (RegistryKey root in new RegistryKey[] { Registry.CurrentUser, Registry.LocalMachine })
                using (RegistryKey key = root.OpenSubKey(RunKey)) if (key != null && key.GetValue("QLBS_Kiosk_Agent") != null) legacy = true;
            if (!legacy) return;
            bool restartExplorer = false;
            foreach (RegistryKey root in new RegistryKey[] { Registry.CurrentUser, Registry.LocalMachine })
            foreach (string keyPath in new string[] { @"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer", @"Software\Policies\Microsoft\Windows\Explorer" })
                using (RegistryKey key = root.OpenSubKey(keyPath)) if (key != null && Convert.ToString(key.GetValue("NoWinKeys"), CultureInfo.InvariantCulture) == "1") restartExplorer = true;
            foreach (RegistryKey root in new RegistryKey[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                DeleteValue(root, RunKey, "QLBS_Kiosk_Agent");
                DeleteValue(root, @"Software\Microsoft\Windows\CurrentVersion\Policies\System", "DisableTaskMgr");
                DeleteValue(root, @"Software\Microsoft\Windows\CurrentVersion\Policies\System", "DisableLockWorkstation");
                DeleteValue(root, @"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer", "NoWinKeys");
                DeleteValue(root, @"Software\Policies\Microsoft\Windows\Explorer", "NoWinKeys");
                DeleteValue(root, @"SOFTWARE\Policies\Microsoft\Edge", "DeveloperToolsAvailability");
                DeleteValue(root, @"SOFTWARE\Policies\Google\Chrome", "DeveloperToolsAvailability");
            }
            string startup = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonStartup), "QLBS_Kiosk_Agent.bat");
            if (File.Exists(startup)) File.Delete(startup);
            RunTool("schtasks.exe", "/delete /tn QLBS_Kiosk_Agent /f");
            // Close ONLY the old kiosk browser profile, never a doctor's normal Edge/Chrome tabs.
            string command = "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'msedge.exe' -or $_.Name -eq 'chrome.exe') -and $_.CommandLine -like '*QLBS_Kiosk*EdgeProfile*' -and $_.CommandLine -like '*--kiosk*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
            RunTool("powershell.exe", "-NoProfile -NonInteractive -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(command)));
            if (restartExplorer && Process.GetCurrentProcess().SessionId != 0)
            {
                // Only a legacy NoWinKeys policy needs a shell refresh; never terminate HIS or unrelated browsers.
                foreach (Process process in Process.GetProcessesByName("explorer"))
                using (process)
                {
                    if (process.SessionId != Process.GetCurrentProcess().SessionId) continue;
                    try { process.Kill(); process.WaitForExit(3000); } catch (Win32Exception) { Log.Write("Legacy Explorer policy requires sign-out."); }
                }
                Process.Start(new ProcessStartInfo("explorer.exe") { UseShellExecute = true });
            }
            Directory.CreateDirectory(Program.DataDirectory);
            string flagStaging = Path.Combine(Program.DataDirectory, "migration-" + Guid.NewGuid().ToString("N") + ".new");
            using (StreamWriter writer = new StreamWriter(new FileStream(flagStaging, FileMode.CreateNew, FileAccess.Write, FileShare.None), new UTF8Encoding(false))) writer.Write("QLBS Kiosk " + Program.Version + " legacy migration complete");
            try { if (File.Exists(migrationFlag)) File.Delete(migrationFlag); File.Move(flagStaging, migrationFlag); }
            finally { if (File.Exists(flagStaging)) File.Delete(flagStaging); }
        }

        private static void RunTool(string name, string arguments)
        {
            try
            {
                ProcessStartInfo info = new ProcessStartInfo(name, arguments) { UseShellExecute = false, CreateNoWindow = true };
                using (Process process = Process.Start(info)) if (!process.WaitForExit(10000)) process.Kill();
            }
            catch (Exception ex) { Log.Write("Optional migration tool: " + name + ": " + ex.GetType().Name); }
        }
        internal static int Uninstall(Options options)
        {
            if (!IsAdmin())
            {
                if (options.Has("quiet")) throw new UnauthorizedAccessException("Gỡ bỏ cần quyền Administrator.");
                ProcessStartInfo start = new ProcessStartInfo(Application.ExecutablePath, "/uninstall" + (options.Has("purge") ? " /purge" : "")) { UseShellExecute = true, Verb = "runas" };
                using (Process child = Process.Start(start)) { child.WaitForExit(); return child.ExitCode; }
            }
            if (!options.Has("quiet") && MessageBox.Show("Gỡ QLBS Kiosk và ngừng tự bảo vệ máy trạm?\nCấu hình mã phòng được giữ lại trừ khi chọn /purge.", "Gỡ QLBS Kiosk", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return 2;
            bool acquired;
            using (Mutex setup = new Mutex(true, @"Global\QLBS_Kiosk_Setup_v2", out acquired))
            {
                if (!acquired) throw new InvalidOperationException("Một phiên cài đặt/gỡ bỏ khác đang chạy.");
                try { return UninstallCore(options); }
                finally { setup.ReleaseMutex(); }
            }
        }
        internal static string DeferredRemovalScript(int processId, string marker, string directory = null)
        {
            // A fresh install removes the marker under the same mutex. The old helper can then
            // never remove the newly installed version, even if both actions overlap at exit.
            return "Wait-Process -Id " + processId.ToString(CultureInfo.InvariantCulture) + " -ErrorAction SilentlyContinue; " +
                "$m=[Threading.Mutex]::new($false,'Global\\QLBS_Kiosk_Setup_v2'); $owned=$false; try { " +
                "try { $owned=$m.WaitOne(30000) } catch [Threading.AbandonedMutexException] { $owned=$true }; " +
                "if ($owned -and (Test-Path -LiteralPath '" + marker.Replace("'", "''") + "')) { " +
                "Remove-Item -LiteralPath '" + (directory ?? Program.InstallDirectory).Replace("'", "''") + "' -Recurse -Force -ErrorAction Stop } " +
                "} finally { if ($owned) { $m.ReleaseMutex() }; $m.Dispose() }";
        }
        private static int UninstallCore(Options options)
        {
            StopOwnedProcesses();
            using (RegistryKey key = Registry.LocalMachine.OpenSubKey(RunKey, true)) if (key != null) key.DeleteValue("QLBS_Kiosk", false);
            Registry.LocalMachine.DeleteSubKeyTree(UninstallKey, false);
            CleanupLegacy();
            if (options.Has("purge") && Directory.Exists(Program.DataDirectory)) Directory.Delete(Program.DataDirectory, true);
            // A running EXE cannot delete itself. Schedule only this exact known install directory after exit.
            string target = Path.Combine(Program.InstallDirectory, "QLBS_Kiosk.exe");
            if (String.Equals(Application.ExecutablePath, target, StringComparison.OrdinalIgnoreCase))
            {
                string marker = Path.Combine(Program.InstallDirectory, ".uninstall-" + Guid.NewGuid().ToString("N") + ".pending");
                File.WriteAllText(marker, "Pending removal", new UTF8Encoding(false));
                string script = DeferredRemovalScript(Process.GetCurrentProcess().Id, marker);
                Process.Start(new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(script))) { UseShellExecute = false, CreateNoWindow = true });
            }
            else if (Directory.Exists(Program.InstallDirectory)) Directory.Delete(Program.InstallDirectory, true);
            Log.Write("Kiosk uninstalled; Windows keyboard hook removed by process termination.");
            if (!options.Has("quiet")) MessageBox.Show("Đã gỡ Kiosk. Desktop và các phím Windows hoạt động bình thường.\nNếu máy từng dùng Agent cũ có NoWinKeys, đăng xuất/đăng nhập để Explorer nạp lại chính sách.", "QLBS Kiosk", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
    }

    internal static class SelfTests
    {
        private static void Assert(bool condition, string message) { if (!condition) throw new Exception("SELF-TEST FAILED: " + message); }
        internal static int Run(string output)
        {
            try
            {
                Assert(KioskConfig.NormalizeServer("https://hospital.test:3443/") == "https://hospital.test:3443", "server origin");
                foreach (string bad in new string[] { "file:///tmp/a", "https://user:pass@host/", "https://host/api", "https://host/?a=b", "https://host/#a" })
                {
                    bool rejected = false; try { KioskConfig.NormalizeServer(bad); } catch (ArgumentException) { rejected = true; }
                    Assert(rejected, "reject unsafe server URL");
                }
                Assert(Json.Decode("{\"success\":true,\"data\":null}").Count == 0, "null envelope");
                Assert(!Json.Flag(Json.Decode("{\"isUnlocked\":\"true\"}"), "isUnlocked"), "strict JSON boolean");
                ServerClock clock = new ServerClock(); clock.Sync(1792000000000d, 0);
                Assert(clock.Now >= 1792000000000d && clock.Now < 1792000001000d, "monotonic server clock");
                List<string> events = new List<string>(); SseParser parser = new SseParser();
                Action<string, string> collect = delegate(string name, string data) { events.Add(name + "|" + data); };
                foreach (string line in new string[] { ":heartbeat", "event: SESSION_SCANNED", "data: {\"a\":", "data: 1}", "", "data: ok", "" }) parser.Push(line, collect);
                Assert(events.Count == 2 && events[0] == "SESSION_SCANNED|{\"a\":\n1}" && events[1] == "message|ok", "SSE framing, multi-line data, heartbeat, event reset");
                bool oversized = false; try { parser.Push(new string('x', 32769), collect); } catch (InvalidDataException) { oversized = true; }
                Assert(oversized, "bounded SSE");
                KioskConfig config = new KioskConfig { ServerUrl = "https://hospital.test", RoomCode = "PK01", TerminalId = "term_12345678901234567890123456789012" }; config.Validate();
                string session = "e270973a-0bc2-4bfd-89f9-9d6a876f7031";
                Dictionary<string, object> payload = Json.Decode("{\"protocolVersion\":2,\"terminalId\":\"" + config.TerminalId + "\",\"roomExists\":true,\"kioskRequired\":true,\"room\":{\"code\":\"PK01\",\"name\":\"Phòng khám 1\"},\"serverTime\":1792000000000,\"isUnlocked\":false,\"qrSession\":{\"sessionId\":\"" + session + "\",\"qrUrl\":\"https://hospital.test/scan/" + session + "\",\"expiresAt\":1792000015000,\"totalExpiresSeconds\":15,\"faceVerifyBufferSeconds\":60,\"status\":\"WAITING\"}}");
                KioskSnapshot snapshot = KioskSnapshot.Parse(payload, config); Assert(snapshot.Qr != null && !snapshot.Scanned, "waiting QR");
                Dictionary<string, object> qr = Json.Object(payload["qrSession"]); qr["status"] = "SCANNED"; qr["scannedAt"] = 1792000000000d;
                snapshot = KioskSnapshot.Parse(payload, config); Assert(snapshot.Scanned && snapshot.Qr == null, "scanned never renders QR");
                payload["terminalId"] = "wrong-terminal"; bool wrong = false; try { KioskSnapshot.Parse(payload, config); } catch (InvalidDataException) { wrong = true; }
                Assert(wrong, "terminal isolation");
                payload["terminalId"] = config.TerminalId;
                KioskView view = new KioskView { RoomCode = "PK01" };
                qr["status"] = "WAITING"; qr["scannedAt"] = null;
                KioskSnapshot waiting = KioskSnapshot.Parse(payload, config);
                Assert(view.ApplySnapshot(waiting, 0) && view.Locked && view.Qr != null, "locked snapshot");
                Assert(view.ObserveScan(session, waiting.ServerTime + 60000, 60) && view.Scanned && view.Qr == null, "immediate opaque mask");
                view.ApplySnapshot(waiting, 0);
                Assert(view.Scanned && view.Qr == null && view.ExpiresAt == waiting.ServerTime + 60000, "no scanned-to-waiting regression");
                payload["kioskRequired"] = false; payload["isUnlocked"] = false; payload["shiftEndMs"] = 0;
                KioskSnapshot released = KioskSnapshot.Parse(payload, config);
                view.ApplySnapshot(released, 0); Assert(!view.Locked && view.Qr == null && view.SessionId == "", "no active shift releases desktop");
                Assert(!view.ObserveScan(session, waiting.ServerTime + 60000, 60), "late scan cannot reopen a released kiosk");
                view.MarkReleased("offline", true); Assert(!view.Locked && !view.Connected && view.Qr == null, "offline releases desktop");
                payload["kioskRequired"] = true; payload["isUnlocked"] = true; bool noDeadline = false; try { KioskSnapshot.Parse(payload, config); } catch (InvalidDataException) { noDeadline = true; }
                Assert(noDeadline, "active-shift unlock requires finite deadline");
                Assert(KeyboardPolicy.PermitsPinKey(0x39, false, false, false) && KeyboardPolicy.PermitsPinKey(0x08, false, false, false), "PIN typing and backspace");
                Assert(!KeyboardPolicy.PermitsPinKey(0x5B, false, false, false) && !KeyboardPolicy.PermitsPinKey(0x09, false, true, false) && !KeyboardPolicy.PermitsPinKey(0x73, false, true, false) && !KeyboardPolicy.PermitsPinKey(0x1B, true, false, false), "system escape keys blocked inside PIN dialog");
                Assert(!KeyboardPolicy.PermitsPinKey(0x44, false, false, true), "Win+D is blocked with Win already held");
                string directory = output.Length > 0 ? output : Path.Combine(Path.GetTempPath(), "qlbs-kiosk-tests"); Directory.CreateDirectory(directory);
                List<object> matrices = new List<object>();
                for (int version = 1; version <= 40; version++)
                {
                    int length = (QrCode.GetNumDataCodewords(version, QrCode.Ecc.Medium) * 8 - 4 - (version < 10 ? 8 : 16)) / 8;
                    string text = new string('a', length);
                    QrCode code = QrCode.EncodeText(text, QrCode.Ecc.Medium);
                    Assert(code.Version == version, "byte capacity for version " + version);
                    string[] rows = new string[code.Size];
                    for (int row = 0; row < code.Size; row++)
                    {
                        StringBuilder bits = new StringBuilder(code.Size);
                        for (int col = 0; col < code.Size; col++) bits.Append(code.GetModule(col, row) ? '1' : '0');
                        rows[row] = bits.ToString();
                    }
                    matrices.Add(new { version = version, mask = code.Mask, text = text, rows = rows });
                }
                File.WriteAllText(Path.Combine(directory, "qr-matrices.json"), Json.Encode(matrices), new UTF8Encoding(false));
                string[] urls = new string[] { "https://hospital.test/scan/" + session, "http://192.168.10.100:3000/scan/" + session, "https://" + new string('a', 54) + ".hospital.vn:3443/scan/" + session, "https://hospital.vn/scan/" + session + "?unicode=ViệtNam" };
                for (int i = 0; i < urls.Length; i++)
                {
                    QrCode code = QrCode.EncodeText(urls[i], QrCode.Ecc.Medium);
                    Assert(code.Size == code.Version * 4 + 17 && code.GetModule(0, 0), "QR matrix structure");
                    using (Bitmap bitmap = new Bitmap((code.Size + 8) * 6, (code.Size + 8) * 6))
                    using (Graphics g = Graphics.FromImage(bitmap)) { g.Clear(Color.White); KioskArt.Qr(g, code, new RectangleF(0, 0, bitmap.Width, bitmap.Height)); bitmap.Save(Path.Combine(directory, "qr-" + i + ".png"), ImageFormat.Png); }
                }
                File.WriteAllLines(Path.Combine(directory, "expected-urls.txt"), urls, new UTF8Encoding(false));
                string removalFixture = Path.Combine(Path.GetFullPath(directory), "uninstall-fixture-" + Guid.NewGuid().ToString("N"));
                string removalMarker = Path.Combine(removalFixture, ".uninstall-test.pending");
                string removalScript = Installer.DeferredRemovalScript(Int32.MaxValue, removalMarker, removalFixture);
                File.WriteAllText(Path.Combine(directory, "deferred-uninstall.ps1"), removalScript, new UTF8Encoding(false));
                // Actual PowerShell execution is confined to a fresh, random test directory.
                // Windows self-tests exercise cancellation + deletion, never Program Files.
                if (Environment.OSVersion.Platform == PlatformID.Win32NT)
                {
                    Directory.CreateDirectory(removalFixture);
                    File.WriteAllText(Path.Combine(removalFixture, "new-install.txt"), "new version");
                    RunRemovalFixture(removalScript);
                    Assert(File.Exists(Path.Combine(removalFixture, "new-install.txt")), "cancelled uninstall preserves the new install");
                    File.WriteAllText(removalMarker, "pending");
                    RunRemovalFixture(removalScript);
                    Assert(!Directory.Exists(removalFixture), "own pending uninstall removes its test directory");
                }
                File.WriteAllText(Path.Combine(directory, "self-test.txt"), "PASS: config, strict JSON, server clock, SSE framing/limits, terminal targeting, active-shift lock/release transitions, offline desktop release, keyboard policy, all 40 QR versions\n", Encoding.UTF8);
                Console.WriteLine("QLBS Kiosk self-tests passed: " + directory); return 0;
            }
            catch (Exception ex) { Console.Error.WriteLine(ex.ToString()); return 1; }
        }
        private static void RunRemovalFixture(string script)
        {
            ProcessStartInfo info = new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(script))) { UseShellExecute = false, CreateNoWindow = true };
            using (Process child = Process.Start(info))
            {
                if (!child.WaitForExit(35000)) { child.Kill(); throw new Exception("Deferred removal fixture timed out"); }
                Assert(child.ExitCode == 0, "deferred removal PowerShell exit code");
            }
        }
        internal static int Snapshot(string output, bool scanned)
        {
            KioskView view = new KioskView { RoomCode = "PK01", RoomName = "Phòng khám Nội tổng hợp 01", Connected = true, DoctorName = "BS. Nguyễn Minh Anh", ShiftName = "Ca sáng", ShiftHours = "07:00 – 11:00", DutyDate = "2026-10-15", SessionId = "e270973a-0bc2-4bfd-89f9-9d6a876f7031", Scanned = scanned };
            view.Clock.Sync(1792024200000d, 0); view.ExpiresAt = view.Clock.Now + (scanned ? 60000 : 15000);
            view.Qr = scanned ? null : QrCode.EncodeText("https://hospital.test/scan/" + view.SessionId, QrCode.Ecc.Medium);
            using (LockForm form = new LockForm(view, true, delegate { }))
            {
                form.Bounds = new Rectangle(0, 0, 1366, 768); form.CreateControl();
                using (Bitmap image = new Bitmap(1366, 768)) { form.DrawToBitmap(image, new Rectangle(0, 0, 1366, 768)); image.Save(output, ImageFormat.Png); }
                form.AllowClose = true;
            }
            return 0;
        }
    }
}

// Native QR implementation follows. Vendored MIT code and compatibility notes are retained below.
/*
 * QR code generator library (.NET)
 *
 * Copyright (c) Manuel Bleichenbacher (MIT License)
 * https://github.com/manuelbl/QrCodeGenerator
 * Copyright (c) Project Nayuki (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

// Vendored from manuelbl/QrCodeGenerator v1.6.0; C# 5 property/name syntax, byte-only factory.

namespace Net.Codecrete.QrCodeGenerator
{
    internal sealed class QrCode
    {
        // Byte-mode UTF-8 encoder; the standard matrix/ECC/masking implementation below is unmodified.
        internal static QrCode EncodeText(string text, Ecc ecl)
        {
            if (text == null) throw new ArgumentNullException("text");
            byte[] bytes = Encoding.UTF8.GetBytes(text);
            int version;
            for (version = 1; version <= 40; version++)
            {
                int countBits = version < 10 ? 8 : 16;
                if (bytes.Length < (1 << countBits) && 4 + countBits + bytes.Length * 8 <= GetNumDataCodewords(version, ecl) * 8) break;
            }
            if (version > 40) throw new ArgumentException("QR URL is too long.");
            List<bool> bits = new List<bool>();
            Append(bits, 4, 4);
            Append(bits, bytes.Length, version < 10 ? 8 : 16);
            foreach (byte b in bytes) Append(bits, b, 8);
            int capacity = GetNumDataCodewords(version, ecl) * 8;
            Append(bits, 0, Math.Min(4, capacity - bits.Count));
            while (bits.Count % 8 != 0) bits.Add(false);
            for (int pad = 0xEC; bits.Count < capacity; pad ^= 0xEC ^ 0x11) Append(bits, pad, 8);
            byte[] data = new byte[bits.Count / 8];
            for (int i = 0; i < bits.Count; i++) if (bits[i]) data[i >> 3] |= (byte)(1 << (7 - (i & 7)));
            return new QrCode(version, ecl, data);
        }
        private static void Append(List<bool> bits, int value, int length)
        {
            for (int i = length - 1; i >= 0; i--) bits.Add(((value >> i) & 1) != 0);
        }
        public int Version { get; private set; }

        public int Size { get; private set; }

        public Ecc ErrorCorrectionLevel { get; private set; }

        public int Mask { get; private set; }




        // The modules of this QR code (false = white, true = black).
        // Immutable after constructor finishes. Accessed through GetModule().
        private readonly bool[] _modules;

        // Indicates function modules that are not subjected to masking. Discarded when constructor finishes.
        private readonly bool[] _isFunction;




        public QrCode(int version, Ecc ecl, byte[] dataCodewords, int mask = -1)
        {
            // Check arguments and initialize fields
            if (version < MinVersion || version > MaxVersion)
            {
                throw new ArgumentOutOfRangeException("version", "Version value out of range");
            }

            if (mask < -1 || mask > 7)
            {
                throw new ArgumentOutOfRangeException("mask", "Mask value out of range");
            }

            Version = version;
            Size = version * 4 + 17;
            if (ecl == null) throw new ArgumentNullException("ecl");
            ErrorCorrectionLevel = ecl;
            if (dataCodewords == null) throw new ArgumentNullException("dataCodewords");
            _modules = new bool[Size * Size];  // Initially all white
            _isFunction = new bool[Size * Size];

            // Compute ECC, draw modules, do masking
            DrawFunctionPatterns();
            byte[] allCodewords = AddEccAndInterleave(dataCodewords);
            DrawCodewords(allCodewords);
            Mask = HandleConstructorMasking(mask);
            _isFunction = null;
        }





        public bool GetModule(int x, int y)
        {
            return 0 <= x && x < Size && 0 <= y && y < Size && _modules[y * Size + x];
        }


        private void DrawFunctionPatterns()
        {
            // Draw horizontal and vertical timing patterns
            for (int i = 0; i < Size; i++)
            {
                SetFunctionModule(6, i, i % 2 == 0);
                SetFunctionModule(i, 6, i % 2 == 0);
            }

            // Draw 3 finder patterns (all corners except bottom right; overwrites some timing modules)
            DrawFinderPattern(3, 3);
            DrawFinderPattern(Size - 4, 3);
            DrawFinderPattern(3, Size - 4);

            // Draw numerous alignment patterns
            int[] alignPatPos = GetAlignmentPatternPositions();
            int numAlign = alignPatPos.Length;
            for (int i = 0; i < numAlign; i++)
            {
                for (int j = 0; j < numAlign; j++)
                {
                    // Don't draw on the three finder corners
                    if (!(i == 0 && j == 0 || i == 0 && j == numAlign - 1 || i == numAlign - 1 && j == 0))
                    {
                        DrawAlignmentPattern(alignPatPos[i], alignPatPos[j]);
                    }
                }
            }

            // Draw configuration data
            DrawFormatBits(0);  // Dummy mask value; overwritten later in the constructor
            DrawVersion();
        }


        // Draws two copies of the format bits (with its own error correction code)
        // based on the given mask and this object's error correction level field.
        private void DrawFormatBits(uint mask)
        {
            // Calculate error correction code and pack bits
            uint data = (ErrorCorrectionLevel.FormatBits << 3) | mask;  // errCorrLvl is uint2, mask is uint3
            uint rem = data;
            for (int i = 0; i < 10; i++)
            {
                rem = (rem << 1) ^ ((rem >> 9) * 0x537);
            }

            uint bits = ((data << 10) | rem) ^ 0x5412;  // uint15
            Debug.Assert(bits >> 15 == 0);

            // Draw first copy
            for (int i = 0; i <= 5; i++)
            {
                SetFunctionModule(8, i, GetBit(bits, i));
            }

            SetFunctionModule(8, 7, GetBit(bits, 6));
            SetFunctionModule(8, 8, GetBit(bits, 7));
            SetFunctionModule(7, 8, GetBit(bits, 8));
            for (int i = 9; i < 15; i++)
            {
                SetFunctionModule(14 - i, 8, GetBit(bits, i));
            }

            // Draw second copy
            for (int i = 0; i < 8; i++)
            {
                SetFunctionModule(Size - 1 - i, 8, GetBit(bits, i));
            }

            for (int i = 8; i < 15; i++)
            {
                SetFunctionModule(8, Size - 15 + i, GetBit(bits, i));
            }

            SetFunctionModule(8, Size - 8, true);  // Always black
        }


        // Draws two copies of the version bits (with its own error correction code),
        // based on this object's version field, iff 7 <= version <= 40.
        private void DrawVersion()
        {
            if (Version < 7)
            {
                return;
            }

            // Calculate error correction code and pack bits
            uint rem = (uint)Version;  // version is uint6, in the range [7, 40]
            for (int i = 0; i < 12; i++)
            {
                rem = (rem << 1) ^ ((rem >> 11) * 0x1F25);
            }

            uint bits = ((uint)Version << 12) | rem;  // uint18
            Debug.Assert(bits >> 18 == 0);

            // Draw two copies
            for (int i = 0; i < 18; i++)
            {
                bool bit = GetBit(bits, i);
                int a = Size - 11 + i % 3;
                int b = i / 3;
                SetFunctionModule(a, b, bit);
                SetFunctionModule(b, a, bit);
            }
        }

        // Draws a 9*9 finder pattern including the border separator,
        // with the center module at (x, y). Modules can be out of bounds.
        private void DrawFinderPattern(int x, int y)
        {
            for (int dy = -4; dy <= 4; dy++)
            {
                for (int dx = -4; dx <= 4; dx++)
                {
                    int dist = Math.Max(Math.Abs(dx), Math.Abs(dy));  // Chebyshev/infinity norm
                    int xx = x + dx, yy = y + dy;
                    if (0 <= xx && xx < Size && 0 <= yy && yy < Size)
                    {
                        SetFunctionModule(xx, yy, dist != 2 && dist != 4);
                    }
                }
            }
        }


        // Draws a 5*5 alignment pattern, with the center module
        // at (x, y). All modules must be in bounds.
        private void DrawAlignmentPattern(int x, int y)
        {
            for (int dy = -2; dy <= 2; dy++)
            {
                for (int dx = -2; dx <= 2; dx++)
                {
                    SetFunctionModule(x + dx, y + dy, Math.Max(Math.Abs(dx), Math.Abs(dy)) != 1);
                }
            }
        }


        // Sets the color of a module and marks it as a function module.
        // Only used by the constructor. Coordinates must be in bounds.
        private void SetFunctionModule(int x, int y, bool isBlack)
        {
            _modules[y * Size + x] = isBlack;
            _isFunction[y * Size + x] = true;
        }




        // Returns a new byte string representing the given data with the appropriate error correction
        // codewords appended to it, based on this object's version and error correction level.
        private byte[] AddEccAndInterleave(byte[] data)
        {
            if (data == null) throw new ArgumentNullException("data");
            if (data.Length != GetNumDataCodewords(Version, ErrorCorrectionLevel))
            {
                throw new ArgumentOutOfRangeException();
            }

            // Calculate parameter numbers
            int numBlocks = NumErrorCorrectionBlocks[ErrorCorrectionLevel.Ordinal, Version];
            int blockEccLen = EccCodewordsPerBlock[ErrorCorrectionLevel.Ordinal, Version];
            int rawCodewords = GetNumRawDataModules(Version) / 8;
            int numShortBlocks = numBlocks - rawCodewords % numBlocks;
            int shortBlockLen = rawCodewords / numBlocks;

            // Split data into blocks and append ECC to each block
            byte[][] blocks = new byte[numBlocks][];
            ReedSolomonGenerator rs = new ReedSolomonGenerator(blockEccLen);
            for (int i = 0, k = 0; i < numBlocks; i++)
            {
                byte[] dat = CopyOfRange(data, k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
                k += dat.Length;
                byte[] block = CopyOf(dat, shortBlockLen + 1);
                byte[] ecc = rs.GetRemainder(dat);
                Array.Copy(ecc, 0, block, block.Length - blockEccLen, ecc.Length);
                blocks[i] = block;
            }

            // Interleave (not concatenate) the bytes from every block into a single sequence
            byte[] result = new byte[rawCodewords];
            for (int i = 0, k = 0; i < blocks[0].Length; i++)
            {
                for (int j = 0; j < blocks.Length; j++)
                {
                    // Skip the padding byte in short blocks
                    if (i != shortBlockLen - blockEccLen || j >= numShortBlocks)
                    {
                        result[k] = blocks[j][i];
                        k++;
                    }
                }
            }
            return result;
        }


        // Draws the given sequence of 8-bit codewords (data and error correction) onto the entire
        // data area of this QR code. Function modules need to be marked off before this is called.
        private void DrawCodewords(byte[] data)
        {
            if (data == null) throw new ArgumentNullException("data");
            if (data.Length != GetNumRawDataModules(Version) / 8)
            {
                throw new ArgumentOutOfRangeException();
            }

            int i = 0;  // Bit index into the data
                        // Do the funny zigzag scan
            for (int right = Size - 1; right >= 1; right -= 2)
            {
                // Index of right column in each column pair
                if (right == 6)
                {
                    right = 5;
                }

                for (int vert = 0; vert < Size; vert++)
                {
                    // Vertical counter
                    for (int j = 0; j < 2; j++)
                    {
                        int x = right - j;  // Actual x coordinate
                        bool upward = ((right + 1) & 2) == 0;
                        int y = upward ? Size - 1 - vert : vert;  // Actual y coordinate
                        if (_isFunction[y * Size + x] || i >= data.Length * 8)
                        {
                            continue;
                        }

                        _modules[y * Size + x] = GetBit(data[(uint)i >> 3], 7 - (i & 7));
                        i++;
                        // If this QR code has any remainder bits (0 to 7), they were assigned as
                        // 0/false/white by the constructor and are left unchanged by this method
                    }
                }
            }
            Debug.Assert(i == data.Length * 8);
        }


        // XORs the codeword modules in this QR code with the given mask pattern.
        // The function modules must be marked and the codeword bits must be drawn
        // before masking. Due to the arithmetic of XOR, calling applyMask() with
        // the same mask value a second time will undo the mask. A final well-formed
        // QR code needs exactly one (not zero, two, etc.) mask applied.
        private void ApplyMask(uint mask)
        {
            if (mask > 7)
            {
                throw new ArgumentOutOfRangeException("mask", "Mask value out of range");
            }

            int index = 0;
            for (int y = 0; y < Size; y++)
            {
                for (int x = 0; x < Size; x++)
                {
                    bool invert;
                    switch (mask)
                    {
                        case 0: invert = (x + y) % 2 == 0; break;
                        case 1: invert = y % 2 == 0; break;
                        case 2: invert = x % 3 == 0; break;
                        case 3: invert = (x + y) % 3 == 0; break;
                        case 4: invert = (x / 3 + y / 2) % 2 == 0; break;
                        case 5: invert = x * y % 2 + x * y % 3 == 0; break;
                        case 6: invert = (x * y % 2 + x * y % 3) % 2 == 0; break;
                        case 7: invert = ((x + y) % 2 + x * y % 3) % 2 == 0; break;
                        default: Debug.Assert(false); return;
                    }
                    _modules[index] ^= invert & !_isFunction[index];
                    index++;
                }
            }
        }


        // A messy helper function for the constructor. This QR code must be in an unmasked state when this
        // method is called. The given argument is the requested mask, which is -1 for auto or 0 to 7 for fixed.
        // This method applies and returns the actual mask chosen, from 0 to 7.
        private int HandleConstructorMasking(int mask)
        {
            if (mask == -1)
            {
                // Automatically choose best mask
                int minPenalty = int.MaxValue;
                for (uint i = 0; i < 8; i++)
                {
                    ApplyMask(i);
                    DrawFormatBits(i);
                    int penalty = GetPenaltyScore();
                    if (penalty < minPenalty)
                    {
                        mask = (int)i;
                        minPenalty = penalty;
                    }
                    ApplyMask(i);  // Undoes the mask due to XOR
                }
            }
            Debug.Assert(0 <= mask && mask <= 7);
            ApplyMask((uint)mask);  // Apply the final choice of mask
            DrawFormatBits((uint)mask);  // Overwrite old format bits
            return mask;  // The caller shall assign this value to the final-declared field
        }


        // Calculates and returns the penalty score based on state of this QR code's current modules.
        // This is used by the automatic mask choice algorithm to find the mask pattern that yields the lowest score.
        private int GetPenaltyScore()
        {
            int result = 0;
            FinderPenalty finderPenalty = new FinderPenalty(Size);

            // Adjacent modules in row having same color, and finder-like patterns
            int index = 0;
            for (int y = 0; y < Size; y++)
            {
                bool runColor = false;
                int runX = 0;
                finderPenalty.Reset();
                int padRun = Size; // Add white border to initial run
                for (int x = 0; x < Size; x++)
                {
                    if (_modules[index] == runColor)
                    {
                        runX++;
                        if (runX == 5)
                        {
                            result += PenaltyN1;
                        }
                        else if (runX > 5)
                        {
                            result++;
                        }
                    }
                    else
                    {
                        finderPenalty.AddHistory(runX + padRun);
                        padRun = 0;
                        if (!runColor)
                        {
                            result += finderPenalty.CountPatterns() * PenaltyN3;
                        }

                        runColor = _modules[index];
                        runX = 1;
                    }

                    index++;
                }
                result += finderPenalty.TerminateAndCount(runColor, runX + padRun) * PenaltyN3;
            }

            // Adjacent modules in column having same color, and finder-like patterns
            for (int x = 0; x < Size; x++)
            {
                index = x;
                bool runColor = false;
                int runY = 0;
                finderPenalty.Reset();
                int padRun = Size; // Add white border to initial row
                for (int y = 0; y < Size; y++)
                {
                    if (_modules[index] == runColor)
                    {
                        runY++;
                        if (runY == 5)
                        {
                            result += PenaltyN1;
                        }
                        else if (runY > 5)
                        {
                            result++;
                        }
                    }
                    else
                    {
                        finderPenalty.AddHistory(runY + padRun);
                        padRun = 0;
                        if (!runColor)
                        {
                            result += finderPenalty.CountPatterns() * PenaltyN3;
                        }

                        runColor = _modules[index];
                        runY = 1;
                    }

                    index += Size;
                }
                result += finderPenalty.TerminateAndCount(runColor, runY + padRun) * PenaltyN3;
            }

            // 2*2 blocks of modules having same color
            index = 0;
            for (int y = 0; y < Size - 1; y++)
            {
                for (int x = 0; x < Size - 1; x++)
                {
                    bool color = _modules[index];
                    if (color == _modules[index + 1] &&
                          color == _modules[index + Size] &&
                          color == _modules[index + Size + 1])
                    {
                        result += PenaltyN2;
                    }

                    index++;
                }

                index++;
            }

            // Balance of black and white modules
            int black = 0;
            index = 0;
            for (int y = 0; y < Size; y++)
            {
                for (int x = 0; x < Size; x++)

                {
                    if (_modules[index])
                    {
                        black++;
                    }

                    index++;
                }
            }
            int total = Size * Size;  // Note that size is odd, so black/total != 1/2
                                      // Compute the smallest integer k >= 0 such that (45-5k)% <= black/total <= (55+5k)%
            int k = (Math.Abs(black * 20 - total * 10) + total - 1) / total - 1;
            result += k * PenaltyN4;
            return result;
        }





        // Returns an ascending list of positions of alignment patterns for this version number.
        // Each position is in the range [0,177), and are used on both the x and y axes.
        // This could be implemented as lookup table of 40 variable-length lists of unsigned bytes.
        private int[] GetAlignmentPatternPositions()
        {
            if (Version == 1)
            {
                return new int[] { };
            }

            int numAlign = Version / 7 + 2;
            int step;
            if (Version == 32)  // Special snowflake
            {
                step = 26;
            }
            else  // step = ceil[(size - 13) / (numAlign*2 - 2)] * 2
            {
                step = (Version * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2) * 2;
            }

            int[] result = new int[numAlign];
            result[0] = 6;
            for (int i = result.Length - 1, pos = Size - 7; i >= 1; i--, pos -= step)
            {
                result[i] = pos;
            }

            return result;
        }

        // Returns the number of data bits that can be stored in a QR code of the given version number, after
        // all function modules are excluded. This includes remainder bits, so it might not be a multiple of 8.
        // The result is in the range [208, 29648]. This could be implemented as a 40-entry lookup table.
        private static int GetNumRawDataModules(int ver)
        {
            if (ver < MinVersion || ver > MaxVersion)
            {
                throw new ArgumentOutOfRangeException("ver", "Version number out of range");
            }

            int size = ver * 4 + 17;
            int result = size * size;   // Number of modules in the whole QR code square
            result -= 8 * 8 * 3;        // Subtract the three finders with separators
            result -= 15 * 2 + 1;       // Subtract the format information and black module
            result -= (size - 16) * 2;  // Subtract the timing patterns (excluding finders)
                                        // The five lines above are equivalent to: int result = (16 * ver + 128) * ver + 64;

            if (ver < 2)
            {
                return result;
            }

            int numAlign = ver / 7 + 2;
            result -= (numAlign - 1) * (numAlign - 1) * 25;  // Subtract alignment patterns not overlapping with timing patterns
            result -= (numAlign - 2) * 2 * 20;  // Subtract alignment patterns that overlap with timing patterns
            // The two lines above are equivalent to: result -= (25 * numAlign - 10) * numAlign - 55;
            if (ver >= 7)
            {
                result -= 6 * 3 * 2;  // Subtract version information
            }
            Debug.Assert(208 <= result && result <= 29648);
            return result;
        }


        // Returns the number of 8-bit data (i.e. not error correction) codewords contained in any
        // QR code of the given version number and error correction level, with remainder bits discarded.
        // This stateless pure function could be implemented as a (40*4)-cell lookup table.
        internal static int GetNumDataCodewords(int ver, Ecc ecl)
        {
            return GetNumRawDataModules(ver) / 8
                - EccCodewordsPerBlock[ecl.Ordinal, ver]
                * NumErrorCorrectionBlocks[ecl.Ordinal, ver];
        }

        // Helper class for getPenaltyScore().
        // Internal the run history is organized in reverse order
        // (compared to Nayuki's code) to avoid the copying when
        // adding to the history.
        internal struct FinderPenalty
        {
            private int _length;
            private short[] _runHistory;
            private int _size;

            internal FinderPenalty(int size)
            {
                _length = 0;
                _runHistory = new short[177];
                _size = size;
            }

            internal void Reset()
            {
                _length = 0;
            }

	        // Can only be called immediately after a white run is added, and
	        // returns either 0, 1, or 2.
            internal int CountPatterns()
            {
                if (_length < 7)
                {
                    return 0;
                }
                int n = _runHistory[_length - 6];
                Debug.Assert(n <= _size * 3);
                bool core = n > 0
                    && _runHistory[_length - 5] == n
                    && _runHistory[_length - 4] == n * 3
                    && _runHistory[_length - 3] == n
                    && _runHistory[_length - 2] == n;
                return (core && _runHistory[_length - 7] >= n * 4 && _runHistory[_length - 1] >= n ? 1 : 0)
                     + (core && _runHistory[_length - 1] >= n * 4 && _runHistory[_length - 7] >= n ? 1 : 0);
            }

	        // Pushes the given value to the front and drops the last value.
	        internal int TerminateAndCount(bool currentRunColor, int currentRunLength) {
		        if (currentRunColor) {  // Terminate black run
			        AddHistory(currentRunLength);
			        currentRunLength = 0;
		        }
		        currentRunLength += _size;  // Add white border to final run
		        AddHistory(currentRunLength);
		        return CountPatterns();
	        }

            // Adds the given value to the run history
            internal void AddHistory(int run)
            {
                _runHistory[_length] = (short)run;
                _length++;
            }
        }


        private static byte[] CopyOfRange(byte[] original, int from, int to)
        {
            byte[] result = new byte[to - from];
            Array.Copy(original, from, result, 0, to - from);
            return result;
        }


        private static byte[] CopyOf(byte[] original, int newLength)
        {
            byte[] result = new byte[newLength];
            Array.Copy(original, result, Math.Min(original.Length, newLength));
            return result;
        }


        // Returns true iff the i'th bit of x is set to 1.
        private static bool GetBit(uint x, int i)
        {
            return ((x >> i) & 1) != 0;
        }




        public const int MinVersion = 1;

        public const int MaxVersion = 40;


        // For use in getPenaltyScore(), when evaluating which mask is best.
        private const int PenaltyN1 = 3;
        private const int PenaltyN2 = 3;
        private const int PenaltyN3 = 40;
        private const int PenaltyN4 = 10;


        private static readonly byte[,] EccCodewordsPerBlock = {
		    // Version: (note that index 0 is for padding, and is set to an illegal value)
		    //  0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40     Error correction level
		    { 255,  7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30 },  // Low
		    { 255, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28 },  // Medium
		    { 255, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30 },  // Quartile
		    { 255, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30 },  // High
	    };

        private static readonly byte[,] NumErrorCorrectionBlocks = {
		    // Version: (note that index 0 is for padding, and is set to an illegal value)
		    //  0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40     Error correction level
		    { 255, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4,  4,  4,  4,  4,  6,  6,  6,  6,  7,  8,  8,  9,  9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25 },  // Low
		    { 255, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5,  5,  8,  9,  9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49 },  // Medium
		    { 255, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8,  8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68 },  // Quartile
		    { 255, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81 },  // High
	    };




        public sealed class Ecc
        {
            public static readonly Ecc Low = new Ecc(0, 1);

            public static readonly Ecc Medium = new Ecc(1, 0);

            public static readonly Ecc Quartile = new Ecc(2, 3);

            public static readonly Ecc High = new Ecc(3, 2);


            internal static Ecc[] AllValues = { Low, Medium, Quartile, High };

            public int Ordinal { get; private set; }

            // In the range 0 to 3 (unsigned 2-bit integer).
            internal uint FormatBits { get; private set; }

            // Constructor.
            private Ecc(int ordinal, uint fb)
            {
                Ordinal = ordinal;
                FormatBits = fb;
            }
        }


    }
}
namespace Net.Codecrete.QrCodeGenerator
{
    internal class ReedSolomonGenerator
    {

        // Coefficients of the divisor polynomial, stored from highest to lowest power, excluding the leading term which
        // is always 1. For example the polynomial x^3 + 255x^2 + 8x + 93 is stored as the uint8 array {255, 8, 93}.
        private readonly byte[] _coefficients;




        internal ReedSolomonGenerator(int degree)
        {
            if (degree < 1 || degree > 255)
            {
                throw new ArgumentOutOfRangeException("degree", "Degree out of range");
            }

            // Start with the monomial x^0
            _coefficients = new byte[degree];
            _coefficients[degree - 1] = 1;

            // Compute the product polynomial (x - r^0) * (x - r^1) * (x - r^2) * ... * (x - r^{degree-1}),
            // drop the highest term, and store the rest of the coefficients in order of descending powers.
            // Note that r = 0x02, which is a generator element of this field GF(2^8/0x11D).
            uint root = 1;
            for (int i = 0; i < degree; i++)
            {
                // Multiply the current product by (x - r^i)
                for (int j = 0; j < _coefficients.Length; j++)
                {
                    _coefficients[j] = Multiply(_coefficients[j], root);
                    if (j + 1 < _coefficients.Length)
                    {
                        _coefficients[j] ^= _coefficients[j + 1];
                    }
                }
                root = Multiply(root, 0x02);
            }
        }




        internal byte[] GetRemainder(byte[] data)
        {
            if (data == null) throw new ArgumentNullException("data");

            // Compute the remainder by performing polynomial division
            byte[] result = new byte[_coefficients.Length];
            foreach (byte b in data)
            {
                uint factor = (uint)(b ^ result[0]);
                Array.Copy(result, 1, result, 0, result.Length - 1);
                result[result.Length - 1] = 0;
                for (int i = 0; i < result.Length; i++)
                {
                    result[i] ^= Multiply(_coefficients[i], factor);
                }
            }
            return result;
        }




        // Returns the product of the two given field elements modulo GF(2^8/0x11D). The arguments and result
        // are unsigned 8-bit integers. This could be implemented as a lookup table of 256*256 entries of uint8.
        private static byte Multiply(uint x, uint y)
        {
            Debug.Assert(x >> 8 == 0 && y >> 8 == 0);
            // Russian peasant multiplication
            uint z = 0;
            for (int i = 7; i >= 0; i--)
            {
                z = (z << 1) ^ ((z >> 7) * 0x11D);
                z ^= ((y >> i) & 1) * x;
            }
            Debug.Assert(z >> 8 == 0);
            return (byte)z;
        }

    }
}
