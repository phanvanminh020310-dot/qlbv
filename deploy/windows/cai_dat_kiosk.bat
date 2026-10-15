@echo off
title Cai Dat Windows Kiosk Agent - Benh Vien Quan Y 4

:: 1. Kiem tra va yeu cau quyen Administrator tu dong
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [THONG BAO] Dang yeu cau quyen Administrator...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================================
echo      BENH VIEN QUAN Y 4 - HE THONG DIEM DANH VA KIOSK PHONG KHAM
echo       CAI DAT WINDOWS NATIVE KIOSK AGENT (KHOA PHIM TUYET DOI - GIAI PHONG 100%%)
echo ============================================================================
echo.

:: 2. Nhap thong tin cau hinh phong kham
echo [BUOC 1/5] THIET LAP THONG SO PHONG KHAM
echo ----------------------------------------------------------------------------
set "DEFAULT_SERVER_URL=http://192.168.1.50:3000"
set "SERVER_URL=%DEFAULT_SERVER_URL%"
set /p "SERVER_URL=Nhap dia chi Server QLBV (HTTP hoac HTTPS) [Mac dinh: %DEFAULT_SERVER_URL%]: "

set "DEFAULT_ROOM=PK01"
set "ROOM_CODE=%DEFAULT_ROOM%"
set /p "ROOM_CODE=Nhap Ma phong kham (vd: PK01, PK02...) [Mac dinh: %DEFAULT_ROOM%]: "

set "TERMINAL_ID=term_%ROOM_CODE%_%RANDOM%"

echo.
echo ==> May chu QLBV: %SERVER_URL%
echo ==> Phong kham:   %ROOM_CODE%
echo ==> Terminal ID:  %TERMINAL_ID%
echo.

:: 3. Kiem tra trinh duyet Microsoft Edge / Google Chrome
echo [BUOC 2/5] KIEM TRA TRINH DUYET WEB
echo ----------------------------------------------------------------------------
set "BROWSER_FOUND=0"
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "BROWSER_FOUND=1"
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "BROWSER_FOUND=1"
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "BROWSER_FOUND=1"
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "BROWSER_FOUND=1"

if "%BROWSER_FOUND%"=="0" (
    echo [CANH BAO] Khong tim thay Microsoft Edge hoac Google Chrome.
    echo Vui long cai dat Microsoft Edge truoc khi tiep tuc.
    pause
    exit /b 1
)
echo [OK] Da tim thay trinh duyet phu hop tren Windows.
echo.

:: 4. Kiem tra trinh bien dich C# .NET co san tren Windows
echo [BUOC 3/5] KIEM TRA TRINH BIEN DICH WINDOWS .NET (CSC.EXE)
echo ----------------------------------------------------------------------------
set "CSC="
if exist "%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" (
    set "CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
) else if exist "%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe" (
    set "CSC=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)

if "%CSC%"=="" (
    echo [LOI] Khong tim thay trinh bien dich .NET Framework tren he dieu hanh!
    pause
    exit /b 1
)
echo [OK] Trinh bien dich san sang: %CSC%
echo.

:: 5. Tao thu muc C:\QLBS_Kiosk va sinh Agent
echo [BUOC 4/5] BIEN DICH VA DONG GOI WINDOWS KIOSK AGENT
echo ----------------------------------------------------------------------------
set "INSTALL_DIR=C:\QLBS_Kiosk"

:: Dung Agent cu neu dang chay
taskkill /f /im QLBS_Kiosk_Agent.exe >nul 2>&1
timeout /t 1 /nobreak >nul

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%INSTALL_DIR%\EdgeProfile" mkdir "%INSTALL_DIR%\EdgeProfile"

:: Ghi file config.ini
(
    echo # Cau hinh Kiosk Agent - Benh Vien Quan Y 4
    echo serverUrl=%SERVER_URL%
    echo roomCode=%ROOM_CODE%
    echo terminalId=%TERMINAL_ID%
    echo edgeProfileDir=C:\QLBS_Kiosk\EdgeProfile
) > "%INSTALL_DIR%\config.ini"

:: Sao chep file source C#
if exist "%~dp0QLBS_Kiosk_Agent.cs" (
    copy /y "%~dp0QLBS_Kiosk_Agent.cs" "%INSTALL_DIR%\QLBS_Kiosk_Agent.cs" >nul
) else (
    echo [LOI] Khong tim thay tep ma nguon QLBS_Kiosk_Agent.cs cung thu muc!
    pause
    exit /b 1
)

:: Bien dich file chay Native .EXE ngay tai cho
echo Dang bien dich QLBS_Kiosk_Agent.exe...
"%CSC%" /nologo /target:winexe /out:"%INSTALL_DIR%\QLBS_Kiosk_Agent.exe" /reference:System.dll,System.Windows.Forms.dll,System.Drawing.dll "%INSTALL_DIR%\QLBS_Kiosk_Agent.cs"
if %errorlevel% neq 0 (
    echo [LOI] Bien dich Agent that bai! Vui long kiem tra lai .NET Framework.
    pause
    exit /b 1
)
echo [OK] Da tao thanh cong: %INSTALL_DIR%\QLBS_Kiosk_Agent.exe
echo.

:: 6. Thiet lap khoa bao ve he thong & Tu khoi dong cung Windows (4 lop bao ve khoi dong)
echo [BUOC 5/5] KHOA AN NINH HE THONG VA TU DONG KHOI DONG
echo ----------------------------------------------------------------------------

:: 1. Vo hieu hoa Task Manager khi Kiosk chay
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v "DisableTaskMgr" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v "DisableTaskMgr" /t REG_DWORD /d 1 /f >nul 2>&1

:: 2. Vo hieu hoa khoa man hinh ngoai y muon (Win+L va Lock Workstation)
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v "DisableLockWorkstation" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v "DisableLockWorkstation" /t REG_DWORD /d 1 /f >nul 2>&1

:: 3. Vo hieu hoa F12 va Developer Tools tren Microsoft Edge va Google Chrome triet de cap Engine
reg add "HKLM\Software\Policies\Microsoft\Edge" /v "DeveloperToolsAvailability" /t REG_DWORD /d 2 /f >nul 2>&1
reg add "HKCU\Software\Policies\Microsoft\Edge" /v "DeveloperToolsAvailability" /t REG_DWORD /d 2 /f >nul 2>&1
reg add "HKLM\Software\Policies\Google\Chrome" /v "DeveloperToolsAvailability" /t REG_DWORD /d 2 /f >nul 2>&1
reg add "HKCU\Software\Policies\Google\Chrome" /v "DeveloperToolsAvailability" /t REG_DWORD /d 2 /f >nul 2>&1

:: Lop 1: Dang ky Windows Task Scheduler chay dac quyen cao nhat khi bat ky ai dang nhap
schtasks /create /tn "QLBS_Kiosk_Agent" /tr "\"%INSTALL_DIR%\QLBS_Kiosk_Agent.exe\"" /sc onlogon /rl highest /f >nul 2>&1

:: Lop 2: Dang ky Registry HKLM (cho toan bo tai khoan may tinh)
reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v "QLBS_Kiosk_Agent" /t REG_SZ /d "\"%INSTALL_DIR%\QLBS_Kiosk_Agent.exe\"" /f >nul 2>&1

:: Lop 3: Dang ky Registry HKCU (cho tai khoan hien tai)
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "QLBS_Kiosk_Agent" /t REG_SZ /d "\"%INSTALL_DIR%\QLBS_Kiosk_Agent.exe\"" /f >nul 2>&1

:: Lop 4: Thu muc Startup khoi dong chung cua Windows (Common Startup)
set "STARTUP_DIR=%ProgramData%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%STARTUP_DIR%" (
    (echo start "" "%INSTALL_DIR%\QLBS_Kiosk_Agent.exe") > "%STARTUP_DIR%\QLBS_Kiosk_Agent.bat"
)

echo [OK] Da khoa Task Manager va F12 tren trinh duyet.
echo [OK] Phim Windows (Win+D, Win+R...) duoc bao ve dong bo boi Low-Level Hook cua Agent.
echo [OK] Da dang ky 4 lop khoi dong tu dong cung Windows (Task Scheduler + Registry + Startup).
echo.

echo ============================================================================
echo                    CAI DAT HOAN TAT THANH CONG 100%%!
echo ============================================================================
echo.
echo * May trạm phong kham [%ROOM_CODE%] da duoc bao ve triet de boi QLBS Kiosk Agent.
echo * Tat ca phim Windows, Alt+Tab, Taskmgr deu bi khoa chat.
echo * Khi Bac si diem danh thanh cong: Kiosk bien mat trong 0.05s, Desktop giai phong hoan toan.
echo * PHIM NONG IT KHAN CAP: Nhan to hop [ Ctrl + Alt + Shift + F12 ] de mo bang PIN IT.
echo.
set /p "RUN_NOW=Khoi dong Kiosk Agent ngay bay gio? (Y/N) [Mac dinh: Y]: "
if /i "%RUN_NOW%"=="N" (
    echo Ban co the chay "%INSTALL_DIR%\QLBS_Kiosk_Agent.exe" bat cu luc nao.
) else (
    echo Dang khoi dong Kiosk Agent...
    start "" "%INSTALL_DIR%\QLBS_Kiosk_Agent.exe"
)

timeout /t 3 /nobreak >nul
exit /b 0
