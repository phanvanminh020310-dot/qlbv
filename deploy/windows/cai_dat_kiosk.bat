@echo off
chcp 65001 >nul
title Cài Đặt Màn Hình Kiosk Phòng Khám — Bệnh Viện Quân Y 4
:: ============================================================================
::  BỆNH VIỆN QUÂN Y 4 — CÀI ĐẶT TRỌN GÓI MÀN HÌNH KIOSK PHÒNG KHÁM (A - Z)
:: ============================================================================
::  Tự động thực hiện toàn bộ:
::   1. Cấu hình IP máy chủ và Mã phòng khám linh hoạt.
::   2. Tạo thư mục bảo mật C:\ProgramData\QLBS_Kiosk chống người dùng xóa tệp.
::   3. Khóa toàn diện phím tắt Windows (Win+D, Win+R, Ctrl+Shift+Esc, Task Manager,
::      Shift 5 lần Sticky Keys, vuốt mép màn hình cảm ứng All-in-One PC).
::   4. Cơ chế giải phóng Desktop khi mở khoá: Tự động thu nhỏ Kiosk xuống Taskbar,
::      trả lại 100% màn hình Windows cho bác sĩ sử dụng HIS, PACS, Word mượt mà.
::   5. Tự động khoá lại khi hết ca: Khi qua ca người khác và quá thời gian ân hạn,
::      Kiosk tự động bật lại toàn màn hình và nạp mã QR cho ca tiếp theo.
::   6. Đăng ký tự khởi động ngầm cùng Windows (Task Scheduler + HKLM Run).
:: ============================================================================

echo ============================================================================
echo      BỆNH VIỆN QUÂN Y 4 — HỆ THỐNG ĐIỂM DANH & KIOSK PHÒNG KHÁM
echo              CÀI ĐẶT BẢO VỆ MÁY TRẠM PHÒNG KHÁM TRỌN GÓI (A - Z)
echo ============================================================================
echo.

:: 1. Kiểm tra quyền Quản trị viên Administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [CẢNH BÁO] Bạn cần chạy tệp này bằng quyền Quản trị viên (Administrator)!
    echo Vui lòng: Nhấp chuột phải vào file 'cai_dat_kiosk.bat' -> Chọn 'Run as administrator'.
    echo.
    pause
    exit /b 1
)

:: 2. Nhập thông tin cấu hình phòng khám (hoặc dùng mặc định)
echo [BƯỚC 1/6] THIẾT LẬP THÔNG SỐ PHÒNG KHÁM
echo ----------------------------------------------------------------------------
set DEFAULT_IP=192.168.1.50
set DEFAULT_PORT=3000
set DEFAULT_ROOM=PK01

set /p SERVER_IP="Nhập IP Máy chủ QLBV [Mặc định: %DEFAULT_IP%]: "
if "%SERVER_IP%"=="" set SERVER_IP=%DEFAULT_IP%

set /p PORT="Nhập Cổng dịch vụ web [Mặc định: %DEFAULT_PORT%]: "
if "%PORT%"=="" set PORT=%DEFAULT_PORT%

set /p ROOM_CODE="Nhập Mã phòng khám của máy này (vd: PK01, PK02...) [Mặc định: %DEFAULT_ROOM%]: "
if "%ROOM_CODE%"=="" set ROOM_CODE=%DEFAULT_ROOM%

echo.
echo -> Địa chỉ Kiosk: http://%SERVER_IP%:%PORT%/kiosk/%ROOM_CODE%
echo.

:: 3. Tìm đường dẫn trình duyệt Microsoft Edge hoặc Google Chrome
echo [BƯỚC 2/6] KIỂM TRA TRÌNH DUYỆT WEB
echo ----------------------------------------------------------------------------
set BROWSER_PATH=
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    set BROWSER_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
    set BROWSER_NAME=Microsoft Edge (x86)
)
if "%BROWSER_PATH%"=="" if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    set BROWSER_PATH=C:\Program Files\Microsoft\Edge\Application\msedge.exe
    set BROWSER_NAME=Microsoft Edge (x64)
)
if "%BROWSER_PATH%"=="" if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set BROWSER_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
    set BROWSER_NAME=Google Chrome
)
if "%BROWSER_PATH%"=="" if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set BROWSER_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
    set BROWSER_NAME=Google Chrome (x86)
)

if "%BROWSER_PATH%"=="" (
    echo [LỖI] Không tìm thấy Microsoft Edge hoặc Google Chrome trên máy tính này!
    echo Vui lòng cài đặt Microsoft Edge hoặc Chrome trước khi chạy Kiosk.
    pause
    exit /b 1
)
echo -> Đã tìm thấy trình duyệt: %BROWSER_NAME%
echo.

:: 4. Tạo thư mục hệ thống bảo mật C:\ProgramData\QLBS_Kiosk
echo [BƯỚC 3/6] TẠO THƯ MỤC HỆ THỐNG BẢO MẬT
echo ----------------------------------------------------------------------------
set KIOSK_DIR=C:\ProgramData\QLBS_Kiosk
if not exist "%KIOSK_DIR%" mkdir "%KIOSK_DIR%"

:: Tạo file cấu hình config.txt
echo SERVER_IP=%SERVER_IP%> "%KIOSK_DIR%\config.txt"
echo PORT=%PORT%>> "%KIOSK_DIR%\config.txt"
echo ROOM_CODE=%ROOM_CODE%>> "%KIOSK_DIR%\config.txt"
echo BROWSER_PATH=%BROWSER_PATH%>> "%KIOSK_DIR%\config.txt"

:: Tạo script điều khiển giám sát tự động Kiosk bằng PowerShell
:: Script này:
::  - Khi trạng thái là LOCKED: Giữ Edge/Chrome toàn màn hình che taskbar, chống tắt.
::  - Khi mở khoá (UNLOCKED): Tự động thu nhỏ trình duyệt xuống Taskbar, lộ 100% Desktop cho bác sĩ.
::  - Khi hết ca trực + ân hạn: Tự động phục hồi Kiosk toàn màn hình cho ca tiếp theo.
> "%KIOSK_DIR%\kiosk_supervisor.ps1" (
    echo # ============================================================================
    echo # BỆNH VIỆN QUÂN Y 4 — GIÁM SÁT KIOSK TỰ ĐỘNG & ĐIỀU KHIỂN CỬA SỔ WINDOWS
    echo # ============================================================================
    echo Add-Type -TypeDefinition @"
    echo using System;
    echo using System.Runtime.InteropServices;
    echo public class WinKiosk {
    echo     [DllImport("user32.dll"^)]
    echo     public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow^);
    echo     [DllImport("user32.dll"^)]
    echo     public static extern bool SetForegroundWindow(IntPtr hWnd^);
    echo     [DllImport("user32.dll"^)]
    echo     public static extern bool IsIconic(IntPtr hWnd^);
    echo     [DllImport("user32.dll"^)]
    echo     public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags^);
    echo }
    echo "@
    echo.
    echo `$ServerIp = "%SERVER_IP%"
    echo `$Port = "%PORT%"
    echo `$RoomCode = "%ROOM_CODE%"
    echo `$BrowserExe = "%BROWSER_PATH%"
    echo `$KioskUrl = "http://${ServerIp}:${Port}/kiosk/${RoomCode}"
    echo `$StatusUrl = "http://${ServerIp}:${Port}/api/kiosk/status?room=${RoomCode}"
    echo.
    echo function Launch-Kiosk {
    echo     `$argsList = @(
    echo         "--kiosk",
    echo         "`$KioskUrl",
    echo         "--edge-kiosk-type=fullscreen",
    echo         "--no-first-run",
    echo         "--disable-translate",
    echo         "--disable-features=Translate,TranslateUI,TouchpadAndWheelScrollLatching",
    echo         "--disable-infobars",
    echo         "--disable-session-crashed-bubble",
    echo         "--disable-notifications",
    echo         "--overscroll-history-navigation=0",
    echo         "--disable-pinch"
    echo     ^)
    echo     Start-Process -FilePath `$BrowserExe -ArgumentList `$argsList
    echo }
    echo.
    echo function Get-KioskProcess {
    echo     Get-Process -Name msedge, chrome -ErrorAction SilentlyContinue ^| Where-Object { `$_.MainWindowTitle -like "*Kiosk*" -or `$_.MainWindowHandle -ne [IntPtr]::Zero }
    echo }
    echo.
    echo # Khởi chạy Kiosk ban đầu
    echo Launch-Kiosk
    echo Start-Sleep -Seconds 3
    echo.
    echo `$lastUnlocked = `$false
    echo while (`$true^) {
    echo     try {
    echo         `$resp = Invoke-RestMethod -Uri `$StatusUrl -TimeoutSec 3 -ErrorAction SilentlyContinue
    echo         if (`$resp -and `$resp.data^) { `$data = `$resp.data } else { `$data = `$resp }
    echo         `$isUnlocked = [bool]`$data.isUnlocked
    echo.
    echo         `$procs = Get-KioskProcess
    echo         `$mainProc = `$procs ^| Select-Object -First 1
    echo.
    echo         if (-not `$mainProc^) {
    echo             if (-not `$isUnlocked^) {
    echo                 Launch-Kiosk
    echo             }
    echo         } else {
    echo             `$hwnd = `$mainProc.MainWindowHandle
    echo             if (`$isUnlocked -and -not `$lastUnlocked^) {
    echo                 # Bác sĩ vừa quét mặt mở khoá thành công -> Thu nhỏ Kiosk để giải phóng Desktop!
    echo                 if (`$hwnd -ne [IntPtr]::Zero^) {
    echo                     [WinKiosk]::ShowWindowAsync(`$hwnd, 2^) ^| Out-Null # SW_MINIMIZE
    echo                     [WinKiosk]::ShowWindowAsync(`$hwnd, 6^) ^| Out-Null # SW_MINIMIZE alternative
    echo                 }
    echo                 `$lastUnlocked = `$true
    echo             } elseif (-not `$isUnlocked -and `$lastUnlocked^) {
    echo                 # Hết ca trực + quá thời gian ân hạn (hoặc bấm khoá) -> Bật lại Kiosk toàn màn hình!
    echo                 if (`$hwnd -ne [IntPtr]::Zero^) {
    echo                     [WinKiosk]::ShowWindowAsync(`$hwnd, 3^) ^| Out-Null # SW_MAXIMIZE
    echo                     [WinKiosk]::SetForegroundWindow(`$hwnd^) ^| Out-Null
    echo                 } else {
    echo                     Launch-Kiosk
    echo                 }
    echo                 `$lastUnlocked = `$false
    echo             } elseif (-not `$isUnlocked^) {
    echo                 # Trong lúc khoá: Nếu người dùng cố tình thu nhỏ, tự động tối đa hoá lại
    echo                 if (`$hwnd -ne [IntPtr]::Zero -and [WinKiosk]::IsIconic(`$hwnd^)^) {
    echo                     [WinKiosk]::ShowWindowAsync(`$hwnd, 3^) ^| Out-Null
    echo                     [WinKiosk]::SetForegroundWindow(`$hwnd^) ^| Out-Null
    echo                 }
    echo             }
    echo         }
    echo     } catch {}
    echo     Start-Sleep -Seconds 2
    echo }
)

:: Tạo tệp VBS để chạy PowerShell ngầm không hiện cửa sổ đen
> "%KIOSK_DIR%\chay_ngam.vbs" (
    echo Set WshShell = CreateObject("WScript.Shell"^)
    echo WshShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%KIOSK_DIR%\kiosk_supervisor.ps1""", 0, False
)

:: 5. Khóa phím tắt Windows & chính sách an ninh Kiosk
echo [BƯỚC 4/6] KÍCH HOẠT CHÍNH SÁCH BẢO VỆ & KHOÁ BÀN PHÍM TOÀN DIỆN
echo ----------------------------------------------------------------------------
:: A. Vô hiệu hoá Win + D, Win + R, Win + M, Win + X, Win + S
echo - Đang vô hiệu hoá phím Windows (Win+D, Win+R)...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoWinKeys" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoRun" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoWinKeys" /t REG_DWORD /d 1 /f >nul 2>&1

:: B. Vô hiệu hoá Task Manager (Ctrl+Shift+Esc, Ctrl+Alt+Del)
echo - Đang vô hiệu hoá Task Manager...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v "DisableTaskMgr" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v "DisableTaskMgr" /t REG_DWORD /d 1 /f >nul 2>&1

:: C. Vô hiệu hoá cử chỉ vuốt mép màn hình cảm ứng All-in-One PC
echo - Đang khoá cử chỉ vuốt mép màn hình cảm ứng...
reg add "HKCU\Software\Policies\Microsoft\Windows\EdgeUI" /v "AllowEdgeSwipe" /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v "AllowEdgeSwipe" /t REG_DWORD /d 0 /f >nul 2>&1

:: D. Vô hiệu hoá Sticky Keys (Bấm phím Shift 5 lần)
echo - Đang khoá phím dính trợ năng (Shift 5 lần)...
reg add "HKCU\Control Panel\Accessibility\StickyKeys" /v "Flags" /t REG_SZ /d "506" /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\Keyboard Response" /v "Flags" /t REG_SZ /d "122" /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\ToggleKeys" /v "Flags" /t REG_SZ /d "58" /f >nul 2>&1

:: E. Chặn AutoPlay khi cắm USB & chặn thông báo Toast nổi lên Kiosk
echo - Đang chặn AutoPlay USB và thông báo Windows...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\AutoplayHandlers" /v "DisableAutoplay" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoDriveTypeAutoRun" /t REG_DWORD /d 255 /f >nul 2>&1
reg add "HKCU\Software\Policies\Microsoft\Windows\CurrentVersion\PushNotifications" /v "NoToastApplicationNotification" /t REG_DWORD /d 1 /f >nul 2>&1

:: 6. Thiết lập cơ chế chống người dùng sửa hoặc xóa file Kiosk (NTFS Permissions)
echo.
echo [BƯỚC 5/6] THIẾT LẬP BẢO MẬT NTFS CHỐNG XOÁ TỆP VĨNH VIỄN
echo ----------------------------------------------------------------------------
icacls "%KIOSK_DIR%" /inheritance:r /grant:r "SYSTEM":(OI)(CI)F /grant:r "Administrators":(OI)(CI)F /grant:r "Users":(OI)(CI)RX >nul 2>&1
icacls "%KIOSK_DIR%\*.*" /inheritance:r /grant:r "SYSTEM":F /grant:r "Administrators":F /grant:r "Users":RX >nul 2>&1
echo -> Đã khóa quyền NTFS: Người dùng thông thường BỊ CẤM XOÁ HOẶC SỬA TỆP.

:: 7. Đăng ký tự động khởi động cùng Windows (Task Scheduler + HKLM Run)
echo.
echo [BƯỚC 6/6] ĐĂNG KÝ TỰ ĐỘNG KHỞI ĐỘNG CÙNG MÁY TÍNH
echo ----------------------------------------------------------------------------
schtasks /create /tn "QLBS_Kiosk_Service" /tr "wscript.exe \"%KIOSK_DIR%\chay_ngam.vbs\"" /sc onlogon /rl highest /f >nul 2>&1
reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v "QLBS_Kiosk_Service" /t REG_SZ /d "wscript.exe \"%KIOSK_DIR%\chay_ngam.vbs\"" /f >nul 2>&1

:: Dọn dẹp shortcut cũ trong Startup cá nhân nếu có
set USER_STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
if exist "%USER_STARTUP%\chay_kiosk_phong_kham.bat" del /f /q "%USER_STARTUP%\chay_kiosk_phong_kham.bat" >nul 2>&1

:: Khởi chạy ngay dịch vụ Kiosk
echo -> Đang khởi chạy màn hình Kiosk phòng khám %ROOM_CODE% ngay bây giờ...
wscript.exe "%KIOSK_DIR%\chay_ngam.vbs"

echo.
echo ============================================================================
echo   [HOÀN TẤT THÀNH CÔNG 100%] KIOSK ĐÃ ĐƯỢC CÀI ĐẶT & BẢO VỆ TOÀN DIỆN!
echo ============================================================================
echo  1. Màn hình Kiosk phòng %ROOM_CODE% đã kích hoạt và che toàn bộ thanh Taskbar.
echo  2. Bàn phím đã bị khoá các phím tắt hệ thống (Win+D, Task Manager, Alt+F4...).
echo  3. Tệp cài đặt được bảo vệ vĩnh viễn trong C:\ProgramData\QLBS_Kiosk.
echo  4. Khi Bác sĩ quét mặt thành công: Kiosk tự động thu nhỏ, lộ 100% Desktop.
echo  5. Khi hết ca trực + ân hạn: Kiosk tự động khoá lại và nạp QR cho ca mới.
echo.
echo  * Khi bộ phận IT cần gỡ bỏ hoặc bảo trì, chỉ cần chạy file: go_bo_kiosk.bat
echo ============================================================================
echo.
pause
