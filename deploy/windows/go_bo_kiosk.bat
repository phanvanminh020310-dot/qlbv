@echo off
chcp 65001 >nul
title Gỡ Bỏ Triệt Để Kiosk & Khôi Phục Windows — Bệnh Viện Quân Y 4
:: ============================================================================
::  BỆNH VIỆN QUÂN Y 4 — GỠ BỎ TRIỆT ĐỂ KIOSK & KHÔI PHỤC WINDOWS CHO IT
:: ============================================================================
::  File dự phòng dành riêng cho bộ phận IT khi cần:
::   1. Dừng ngay toàn bộ tiến trình Kiosk, Edge/Chrome Kiosk và script giám sát.
::   2. Xoá tác vụ tự khởi động Task Scheduler và khoá Registry Run.
::   3. Mở lại toàn bộ phím tắt Windows: Win+D, Win+R, Task Manager (Ctrl+Shift+Esc),
::      Sticky Keys, vuốt cảm ứng Edge Swipe.
::   4. Mở khoá quyền bảo mật NTFS và xoá sạch thư mục C:\ProgramData\QLBS_Kiosk.
::   5. Tự động nạp lại Windows Explorer để máy tính hoạt động lại 100% bình thường.
:: ============================================================================

echo ============================================================================
echo      BỆNH VIỆN QUÂN Y 4 — GỠ BỎ KIOSK & KHÔI PHỤC WINDOWS MẶC ĐỊNH
echo               (DÀNH CHO BỘ PHẬN IT QUẢN TRỊ KHI CẦN BẢO TRÌ)
echo ============================================================================
echo.

:: 1. Kiểm tra quyền Quản trị viên Administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [CẢNH BÁO] Bạn cần chạy tệp này bằng quyền Quản trị viên (Administrator)!
    echo Vui lòng: Nhấp chuột phải vào file 'go_bo_kiosk.bat' -> Chọn 'Run as administrator'.
    echo.
    pause
    exit /b 1
)

echo [1/5] Đang dừng các tiến trình Kiosk và đóng trình duyệt...
taskkill /f /im powershell.exe /fi "WINDOWTITLE eq *QLBS*" >nul 2>&1
taskkill /f /im wscript.exe >nul 2>&1
taskkill /f /im msedge.exe >nul 2>&1
taskkill /f /im chrome.exe >nul 2>&1

echo [2/5] Đang gỡ bỏ tác vụ tự khởi động Task Scheduler...
schtasks /delete /tn "QLBS_Kiosk_Service" /f >nul 2>&1
schtasks /delete /tn "QLBS_Attendance_Kiosk" /f >nul 2>&1

echo [3/5] Đang gỡ bỏ khoá Registry tự khởi động...
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v "QLBS_Kiosk_Service" /f >nul 2>&1
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v "QLBS_Attendance_Kiosk" /f >nul 2>&1

echo [4/5] Đang khôi phục toàn bộ bàn phím, Task Manager và cử chỉ Windows...
:: Khôi phục phím Windows (Win, Win+D, Win+R)
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoWinKeys" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoRun" /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoWinKeys" /f >nul 2>&1

:: Khôi phục Task Manager (Ctrl+Shift+Esc)
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v "DisableTaskMgr" /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v "DisableTaskMgr" /f >nul 2>&1

:: Khôi phục vuốt mép màn hình cảm ứng All-in-One PC
reg delete "HKCU\Software\Policies\Microsoft\Windows\EdgeUI" /v "AllowEdgeSwipe" /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v "AllowEdgeSwipe" /f >nul 2>&1

:: Khôi phục phím trợ năng (Shift 5 lần)
reg add "HKCU\Control Panel\Accessibility\StickyKeys" /v "Flags" /t REG_SZ /d "510" /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\Keyboard Response" /v "Flags" /t REG_SZ /d "126" /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\ToggleKeys" /v "Flags" /t REG_SZ /d "62" /f >nul 2>&1

:: Khôi phục AutoPlay USB & thông báo Windows
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\AutoplayHandlers" /v "DisableAutoplay" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoDriveTypeAutoRun" /f >nul 2>&1
reg delete "HKCU\Software\Policies\Microsoft\Windows\CurrentVersion\PushNotifications" /v "NoToastApplicationNotification" /f >nul 2>&1

echo [5/5] Đang mở quyền bảo mật NTFS và dọn dẹp thư mục C:\ProgramData\QLBS_Kiosk...
set KIOSK_DIR=C:\ProgramData\QLBS_Kiosk
if exist "%KIOSK_DIR%" (
    icacls "%KIOSK_DIR%" /reset /t >nul 2>&1
    rd /s /q "%KIOSK_DIR%" >nul 2>&1
)

:: Khởi động lại Windows Explorer để áp dụng ngay lập tức
echo.
echo Đang nạp lại Windows Explorer để trả lại giao diện bình thường...
taskkill /f /im explorer.exe >nul 2>&1
start explorer.exe >nul 2>&1

echo.
echo ============================================================================
echo   [HOÀN TẤT THÀNH CÔNG] ĐÃ GỠ BỎ KIOSK & KHÔI PHỤC MÁY TÍNH VỀ BÌNH THƯỜNG!
echo ============================================================================
echo  - Phím Windows, tổ hợp Win + D, Win + R đã hoạt động trở lại.
echo  - Trình quản lý tác vụ Task Manager (Ctrl + Shift + Esc) đã mở lại bình thường.
echo  - Toàn bộ cơ chế tự khởi động và thư mục hệ thống Kiosk đã được dọn sạch.
echo ============================================================================
echo.
pause
