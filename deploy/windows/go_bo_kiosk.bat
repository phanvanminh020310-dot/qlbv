@echo off
title Go Bo Windows Kiosk Agent - Benh Vien Quan Y 4

:: 1. Kiem tra va yeu cau quyen Administrator tu dong
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [THONG BAO] Dang yeu cau quyen Administrator...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================================
echo      BENH VIEN QUAN Y 4 - HE THONG DIEM DANH VA KIOSK PHONG KHAM
echo           GO BO HOAN TOAN KIOSK AGENT - PHUC HOI DESKTOP NGUYEN BAN
echo ============================================================================
echo.

echo Dang go bo Kiosk va khoi phuc he thong Windows ve trang thai mac dinh...
echo.

:: 2. Dung tien trinh Agent va trinh duyet Kiosk
echo [1/4] Dung cac tien trinh Kiosk...
taskkill /f /im QLBS_Kiosk_Agent.exe >nul 2>&1
taskkill /f /im msedge.exe >nul 2>&1
echo [OK] Da dung toan bo tien trinh Kiosk.

:: 3. Xoa tu dong khoi dong cung Windows
echo [2/4] Xoa dang ky khoi dong cung Windows...
schtasks /delete /tn "QLBS_Kiosk_Agent" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "QLBS_Kiosk_Agent" /f >nul 2>&1
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v "QLBS_Kiosk_Agent" /f >nul 2>&1
if exist "%ProgramData%\Microsoft\Windows\Start Menu\Programs\Startup\QLBS_Kiosk_Agent.bat" (
    del /f /q "%ProgramData%\Microsoft\Windows\Start Menu\Programs\Startup\QLBS_Kiosk_Agent.bat" >nul 2>&1
)
echo [OK] Da xoa sach toan bo cac muc khoi dong tu dong.

:: 4. Khoi phuc Task Manager, phim he thong va Developer Tools
echo [3/4] Khoi phuc Task Manager va quyen he thong...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /f >nul 2>&1
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableLockWorkstation /f >nul 2>&1
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableLockWorkstation /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoWinKeys /f >nul 2>&1
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoWinKeys /f >nul 2>&1
reg delete "HKLM\Software\Policies\Microsoft\Windows\Explorer" /v NoWinKeys /f >nul 2>&1
reg delete "HKLM\Software\Policies\Microsoft\Edge" /v DeveloperToolsAvailability /f >nul 2>&1
reg delete "HKCU\Software\Policies\Microsoft\Edge" /v DeveloperToolsAvailability /f >nul 2>&1
reg delete "HKLM\Software\Policies\Google\Chrome" /v DeveloperToolsAvailability /f >nul 2>&1
reg delete "HKCU\Software\Policies\Google\Chrome" /v DeveloperToolsAvailability /f >nul 2>&1
echo [OK] Da mo khoa lai Task Manager, phim Windows va F12 binh thuong.

:: 5. Xoa thu muc cai dat C:\QLBS_Kiosk
echo [4/5] Don dep thu muc cai dat C:\QLBS_Kiosk...
if exist "C:\QLBS_Kiosk" (
    rmdir /s /q "C:\QLBS_Kiosk" >nul 2>&1
)
echo [OK] Da xoa sach thu muc du lieu va profile Kiosk.

:: 6. Khoi dong lai Windows Explorer de khoi phuc phim Windows ngay lap tuc
echo [5/5] Khoi dong lai Windows Explorer de khoi phuc phim Windows ngay lap tuc...
taskkill /f /im explorer.exe >nul 2>&1
start explorer.exe
echo [OK] Windows Explorer da duoc khoi dong lai - Phim Windows va Task Manager hoat dong binh thuong 100%%.

echo.
echo ============================================================================
echo              GO BO KIOSK THANH CONG! MAY TRAM DA VE NGUYEN BAN!
echo ============================================================================
echo.
echo May tinh phong kham da tro lai hoat dong nhu may tinh Windows van phong thong thuong.
echo.
pause
exit /b 0
