@echo off
title Go Bo Kiosk va Khoi Phuc Windows - Benh Vien Quan Y 4

:: 1. Kiem tra va yeu cau quyen Administrator tu dong
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [THONG BAO] Dang yeu cau quyen Administrator de go bo Kiosk...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================================
echo      BENH VIEN QUAN Y 4 - GO BO KIOSK VA KHOI PHUC WINDOWS MAC DINH
echo               (DANG DUNG CHO BO PHAN IT KHI CAN BAO TRI)
echo ============================================================================
echo.

echo [1/5] Dang dung cac tien trinh Kiosk va dong trinh duyet...
taskkill /f /im powershell.exe /fi "WINDOWTITLE eq *QLBS*" >nul 2>&1
taskkill /f /im wscript.exe >nul 2>&1
taskkill /f /im msedge.exe >nul 2>&1
taskkill /f /im chrome.exe >nul 2>&1

echo [2/5] Dang go bo tac vu tu khoi dong Task Scheduler...
schtasks /delete /tn "QLBS_Kiosk_Service" /f >nul 2>&1
schtasks /delete /tn "QLBS_Attendance_Kiosk" /f >nul 2>&1

echo [3/5] Dang go bo khoa Registry tu khoi dong...
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v "QLBS_Kiosk_Service" /f >nul 2>&1
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v "QLBS_Attendance_Kiosk" /f >nul 2>&1

echo [4/5] Dang khoi phuc toan bo ban phim, Task Manager va cu chi Windows...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoWinKeys" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoRun" /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoWinKeys" /f >nul 2>&1

reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v "DisableTaskMgr" /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v "DisableTaskMgr" /f >nul 2>&1

reg delete "HKCU\Software\Policies\Microsoft\Windows\EdgeUI" /v "AllowEdgeSwipe" /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v "AllowEdgeSwipe" /f >nul 2>&1

reg add "HKCU\Control Panel\Accessibility\StickyKeys" /v "Flags" /t REG_SZ /d "510" /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\Keyboard Response" /v "Flags" /t REG_SZ /d "126" /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\ToggleKeys" /v "Flags" /t REG_SZ /d "62" /f >nul 2>&1

reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\AutoplayHandlers" /v "DisableAutoplay" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoDriveTypeAutoRun" /f >nul 2>&1
reg delete "HKCU\Software\Policies\Microsoft\Windows\CurrentVersion\PushNotifications" /v "NoToastApplicationNotification" /f >nul 2>&1

echo [5/5] Dang mo quyen bao mat NTFS va don dep thu muc C:\ProgramData\QLBS_Kiosk...
set "KIOSK_DIR=C:\ProgramData\QLBS_Kiosk"
if exist "%KIOSK_DIR%" (
    icacls "%KIOSK_DIR%" /reset /t >nul 2>&1
    rd /s /q "%KIOSK_DIR%" >nul 2>&1
)

echo.
echo Dang nap lai Windows Explorer de tra lai giao dien binh thuong...
taskkill /f /im explorer.exe >nul 2>&1
start explorer.exe >nul 2>&1

echo.
echo ============================================================================
echo   [HOAN TAT THANH CONG] DA GO BO KIOSK VA KHOI PHUC MAY TINH VE MAC DINH!
echo ============================================================================
echo  - Phim Windows va to hop Win+D, Win+R da hoat dong tro lai.
echo  - Trinh quan ly tac vu Task Manager (Ctrl+Shift+Esc) da mo lai binh thuong.
echo  - Toan bo co che tu khoi dong va thu muc Kiosk da duoc don sach.
echo ============================================================================
echo.
pause