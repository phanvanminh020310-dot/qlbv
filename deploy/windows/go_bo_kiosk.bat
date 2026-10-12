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
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "QLBS_Kiosk_Agent" /f >nul 2>&1
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v "QLBS_Kiosk_Agent" /f >nul 2>&1
echo [OK] Da xoa khoi muc tu khoi dong.

:: 4. Khoi phuc Task Manager va phim he thong
echo [3/4] Khoi phuc Task Manager va quyen he thong...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /f >nul 2>&1
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /f >nul 2>&1
echo [OK] Da mo khoa lai Task Manager binh thuong.

:: 5. Xoa thu muc cai dat C:\QLBS_Kiosk
echo [4/4] Don dep thu muc cai dat C:\QLBS_Kiosk...
if exist "C:\QLBS_Kiosk" (
    rmdir /s /q "C:\QLBS_Kiosk" >nul 2>&1
)
echo [OK] Da xoa sach thu muc du lieu va profile Kiosk.

echo.
echo ============================================================================
echo              GO BO KIOSK THANH CONG! MAY TRAM DA VE NGUYEN BAN!
echo ============================================================================
echo.
echo May tinh phong kham da tro lai hoat dong nhu may tinh Windows van phong thong thuong.
echo.
pause
exit /b 0
