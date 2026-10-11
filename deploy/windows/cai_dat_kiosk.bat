@echo off
title Cai Dat Man Hinh Kiosk Phong Kham - Benh Vien Quan Y 4

:: 1. Kiem tra va yeu cau quyen Administrator tu dong
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [THONG BAO] Dang yeu cau quyen Administrator...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================================
echo      BENH VIEN QUAN Y 4 - HE THONG DIEM DANH VA KIOSK PHONG KHAM
echo              CAI DAT MAY TRAM PHONG KHAM TRON GOI (A - Z)
echo ============================================================================
echo.

:: 2. Nhap thong tin cau hinh phong kham
echo [BUOC 1/6] THIET LAP THONG SO PHONG KHAM
echo ----------------------------------------------------------------------------
set "DEFAULT_IP=192.168.1.50"
set "DEFAULT_PORT=3000"
set "DEFAULT_ROOM=PK01"

set "SERVER_IP=%DEFAULT_IP%"
set /p "SERVER_IP=Nhap IP May chu QLBV [Mac dinh: %DEFAULT_IP%]: "

set "PORT=%DEFAULT_PORT%"
set /p "PORT=Nhap Cong dich vu web [Mac dinh: %DEFAULT_PORT%]: "

set "ROOM_CODE=%DEFAULT_ROOM%"
set /p "ROOM_CODE=Nhap Ma phong kham (vd: PK01, PK02...) [Mac dinh: %DEFAULT_ROOM%]: "

echo.
echo ==> Dia chi Kiosk: http://%SERVER_IP%:%PORT%/kiosk/%ROOM_CODE%
echo.

:: 3. Kiem tra trinh duyet Microsoft Edge hoac Google Chrome
echo [BUOC 2/6] KIEM TRA TRINH DUYET WEB
echo ----------------------------------------------------------------------------
set "BROWSER_PATH="
set "BROWSER_NAME="

if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    set "BROWSER_NAME=Microsoft Edge (32-bit)"
) else if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_PATH=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    set "BROWSER_NAME=Microsoft Edge (64-bit)"
) else if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
    set "BROWSER_NAME=Google Chrome (64-bit)"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    set "BROWSER_NAME=Google Chrome (32-bit)"
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
    set "BROWSER_NAME=Google Chrome (User AppData)"
) else if exist "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_PATH=%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"
    set "BROWSER_NAME=Microsoft Edge (User AppData)"
)

if "%BROWSER_PATH%"=="" (
    echo [LOI] Khong tim thay trinh duyet Microsoft Edge hoac Google Chrome tren may!
    echo Vui long cai dat Microsoft Edge hoac Google Chrome truoc khi tiep tuc.
    echo.
    pause
    exit /b 1
)

echo ==> Da tim thay trinh duyet: %BROWSER_NAME%
echo.

:: 4. Tao thu muc he thong bao mat C:\ProgramData\QLBS_Kiosk
echo [BUOC 3/6] TAO THU MUC HE THONG BAO MAT
echo ----------------------------------------------------------------------------
set "KIOSK_DIR=C:\ProgramData\QLBS_Kiosk"
if not exist "%KIOSK_DIR%" mkdir "%KIOSK_DIR%"

echo SERVER_IP=%SERVER_IP%> "%KIOSK_DIR%\config.txt"
echo PORT=%PORT%>> "%KIOSK_DIR%\config.txt"
echo ROOM_CODE=%ROOM_CODE%>> "%KIOSK_DIR%\config.txt"
echo BROWSER_PATH=%BROWSER_PATH%>> "%KIOSK_DIR%\config.txt"

echo ==> Dang tao kich ban giam sat Kiosk tu dong...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$b=[System.Convert]::FromBase64String('JEtpb3NrRGlyID0gIkM6XFByb2dyYW1EYXRhXFFMQlNfS2lvc2siCiRDb25maWdGaWxlID0gSm9pbi1QYXRoICRLaW9za0RpciAiY29uZmlnLnR4dCIKCmZ1bmN0aW9uIEdldC1Db25maWcgewogICAgaWYgKC1ub3QgKFRlc3QtUGF0aCAkQ29uZmlnRmlsZSkpIHsgcmV0dXJuICRudWxsIH0KICAgICRjZmcgPSBAe30KICAgIEdldC1Db250ZW50ICRDb25maWdGaWxlIHwgRm9yRWFjaC1PYmplY3QgewogICAgICAgIGlmICgkXyAtbWF0Y2ggIl4oW149XSspPSguKikkIikgeyAkY2ZnWyRtYXRjaGVzWzFdLlRyaW0oKV0gPSAkbWF0Y2hlc1syXS5UcmltKCkgfQogICAgfQogICAgcmV0dXJuICRjZmcKfQoKJGNmZyA9IEdldC1Db25maWcKaWYgKC1ub3QgJGNmZykgeyBleGl0IDAgfQoKJFNlcnZlcklwID0gJGNmZ1siU0VSVkVSX0lQIl0KJFBvcnQgPSAkY2ZnWyJQT1JUIl0KJFJvb21Db2RlID0gJGNmZ1siUk9PTV9DT0RFIl0KJEJyb3dzZXJFeGUgPSAkY2ZnWyJCUk9XU0VSX1BBVEgiXQokS2lvc2tVcmwgPSAiaHR0cDovLyIgKyAkU2VydmVySXAgKyAiOiIgKyAkUG9ydCArICIva2lvc2svIiArICRSb29tQ29kZQokU3RhdHVzVXJsID0gImh0dHA6Ly8iICsgJFNlcnZlcklwICsgIjoiICsgJFBvcnQgKyAiL2FwaS9raW9zay9zdGF0dXM/cm9vbUNvZGU9IiArICRSb29tQ29kZQoKZnVuY3Rpb24gTGF1bmNoLUtpb3NrIHsKICAgICRhcmdzTGlzdCA9IEAoCiAgICAgICAgIi0ta2lvc2siLAogICAgICAgICRLaW9za1VybCwKICAgICAgICAiLS1lZGdlLWtpb3NrLXR5cGU9ZnVsbHNjcmVlbiIsCiAgICAgICAgIi0tbm8tZmlyc3QtcnVuIiwKICAgICAgICAiLS1uby1kZWZhdWx0LWJyb3dzZXItY2hlY2siLAogICAgICAgICItLWRpc2FibGUtZmVhdHVyZXM9VHJhbnNsYXRlLFRyYW5zbGF0ZVVJLE9wdGltaXphdGlvbkhpbnRzLE1lZGlhUm91dGVyIiwKICAgICAgICAiLS1kaXNhYmxlLXRyYW5zbGF0ZSIsCiAgICAgICAgIi0tbGFuZz12aS1WTiIsCiAgICAgICAgIi0tZGlzYWJsZS1waW5jaCIsCiAgICAgICAgIi0tb3ZlcnNjcm9sbC1oaXN0b3J5LW5hdmlnYXRpb249MCIKICAgICkKICAgIFN0YXJ0LVByb2Nlc3MgLUZpbGVQYXRoICRCcm93c2VyRXhlIC1Bcmd1bWVudExpc3QgJGFyZ3NMaXN0Cn0KCmZ1bmN0aW9uIENsb3NlLUtpb3NrIHsKICAgIEdldC1Qcm9jZXNzIC1OYW1lIG1zZWRnZSwgY2hyb21lIC1FcnJvckFjdGlvbiBTaWxlbnRseUNvbnRpbnVlIHwgV2hlcmUtT2JqZWN0IHsKICAgICAgICAkXy5NYWluV2luZG93VGl0bGUgLWxpa2UgIipLaW9zayoiIC1vciAkXy5Db21tYW5kTGluZSAtbGlrZSAiKmtpb3NrKiIgLW9yICRfLkNvbW1hbmRMaW5lIC1saWtlICIqJFJvb21Db2RlKiIKICAgIH0gfCBGb3JFYWNoLU9iamVjdCB7CiAgICAgICAgU3RvcC1Qcm9jZXNzIC1JZCAkXy5Qcm9jZXNzSWQgLUZvcmNlIC1FcnJvckFjdGlvbiBTaWxlbnRseUNvbnRpbnVlCiAgICB9Cn0KCmZ1bmN0aW9uIElzLUtpb3NrUnVubmluZyB7CiAgICAkcHJvY3MgPSBHZXQtUHJvY2VzcyAtTmFtZSBtc2VkZ2UsIGNocm9tZSAtRXJyb3JBY3Rpb24gU2lsZW50bHlDb250aW51ZSB8IFdoZXJlLU9iamVjdCB7CiAgICAgICAgJF8uTWFpbldpbmRvd1RpdGxlIC1saWtlICIqS2lvc2sqIiAtb3IgJF8uQ29tbWFuZExpbmUgLWxpa2UgIipraW9zayoiIC1vciAkXy5Db21tYW5kTGluZSAtbGlrZSAiKiRSb29tQ29kZSoiCiAgICB9CiAgICByZXR1cm4gW2Jvb2xdJHByb2NzCn0KCiMgS2hvaSBjaGF5IEtpb3NrIGJhbiBkYXUKTGF1bmNoLUtpb3NrClN0YXJ0LVNsZWVwIC1TZWNvbmRzIDIKCndoaWxlICgkdHJ1ZSkgewogICAgaWYgKC1ub3QgKFRlc3QtUGF0aCAkQ29uZmlnRmlsZSkpIHsKICAgICAgICBicmVhawogICAgfQoKICAgIHRyeSB7CiAgICAgICAgJHJlc3AgPSBJbnZva2UtUmVzdE1ldGhvZCAtVXJpICRTdGF0dXNVcmwgLU1ldGhvZCBHZXQgLVRpbWVvdXRTZWMgMiAtRXJyb3JBY3Rpb24gU3RvcAogICAgICAgICRkYXRhID0gJHJlc3AKICAgICAgICBpZiAoJHJlc3AgLWFuZCAkcmVzcC5kYXRhIC1uZSAkbnVsbCkgewogICAgICAgICAgICAkZGF0YSA9ICRyZXNwLmRhdGEKICAgICAgICB9CiAgICAgICAgJGlzVW5sb2NrZWQgPSBbYm9vbF0kZGF0YS5pc1VubG9ja2VkCgogICAgICAgIGlmICgkaXNVbmxvY2tlZCkgewogICAgICAgICAgICAjIEtoaSBtbyBraG9hOiBEb25nIGhvYW4gdG9hbiB0cmluaCBkdXlldCBLaW9zayBkZSBnaWFpIHBob25nIDEwMCUgRGVza3RvcCBjaG8gYmFjIHNpCiAgICAgICAgICAgICMgS2hvbmcgY29uIGJhdCBreSBtYW4gaGluaCB0cmFuZyBoYXkgbG9wIHBodSBuYW8gdG9uIHRhaSB0cmVuIG1hbiBoaW5oCiAgICAgICAgICAgIENsb3NlLUtpb3NrCiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgIyBLaGkgZGFuZyBraG9hOiBLaWVtIHRyYSBLaW9zayBjbyBkYW5nIGNoYXkga2hvbmcuIE5ldSBiaSB0YXQgLT4gQmF0IGxhaSB0b2FuIG1hbiBoaW5oIG5nYXkKICAgICAgICAgICAgaWYgKC1ub3QgKElzLUtpb3NrUnVubmluZykpIHsKICAgICAgICAgICAgICAgIExhdW5jaC1LaW9zawogICAgICAgICAgICAgICAgU3RhcnQtU2xlZXAgLVNlY29uZHMgMgogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfSBjYXRjaCB7fQogICAgU3RhcnQtU2xlZXAgLVNlY29uZHMgMQp9'); [System.IO.File]::WriteAllBytes('%KIOSK_DIR%\kiosk_supervisor.ps1', $b)"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$b=[System.Convert]::FromBase64String('U2V0IFdzaFNoZWxsID0gQ3JlYXRlT2JqZWN0KCJXU2NyaXB0LlNoZWxsIikNCldzaFNoZWxsLlJ1biAicG93ZXJzaGVsbC5leGUgLUV4ZWN1dGlvblBvbGljeSBCeXBhc3MgLVdpbmRvd1N0eWxlIEhpZGRlbiAtRmlsZSAiIkM6XFByb2dyYW1EYXRhXFFMQlNfS2lvc2tca2lvc2tfc3VwZXJ2aXNvci5wczEiIiIsIDAsIEZhbHNl'); [System.IO.File]::WriteAllBytes('%KIOSK_DIR%\chay_ngam.vbs', $b)"

:: Tao loi tat Khoa phong kham tren Desktop cho bac si
set "DESKTOP_LOCK=C:\Users\Public\Desktop\KHOA_PHONG_KHAM.bat"
echo @echo off> "%DESKTOP_LOCK%"
echo title Khoa May Tinh Phong Kham %ROOM_CODE%>> "%DESKTOP_LOCK%"
echo powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod -Uri 'http://%SERVER_IP%:%PORT%/api/kiosk/lock' -Method Post -Body '{\"roomCode\":\"%ROOM_CODE%\"}' -ContentType 'application/json' | Out-Null">> "%DESKTOP_LOCK%"
echo echo Da gui tin hieu khoa phong kham %ROOM_CODE%. Man hinh Kiosk dang kich hoat...>> "%DESKTOP_LOCK%"
echo timeout /t 2 >nul>> "%DESKTOP_LOCK%"

:: 5. Khoa ban phim, chan thong bao Translate va chinh sach an ninh Kiosk
echo.
echo [BUOC 4/6] KHOA BAN PHIM, CHAN DICH TRANSLATE VA CHINH SACH AN NINH KIOSK
echo ----------------------------------------------------------------------------
echo - Khoa phim Windows va to hop Win+D, Win+R...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoWinKeys" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoRun" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoWinKeys" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoRun" /t REG_DWORD /d 1 /f >nul 2>&1

echo - Chan triet de bong bong thong bao Translate cua Edge va Chrome...
reg add "HKCU\Software\Policies\Microsoft\Edge" /v "TranslateEnabled" /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v "TranslateEnabled" /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKCU\Software\Policies\Google\Chrome" /v "TranslateEnabled" /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKLM\SOFTWARE\Policies\Google\Chrome" /v "TranslateEnabled" /t REG_DWORD /d 0 /f >nul 2>&1

echo - Khoa Task Manager (Ctrl+Shift+Esc, Ctrl+Alt+Del)...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v "DisableTaskMgr" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v "DisableTaskMgr" /t REG_DWORD /d 1 /f >nul 2>&1

echo - Khoa cu chi vuot mep man hinh cam ung All-in-One PC...
reg add "HKCU\Software\Policies\Microsoft\Windows\EdgeUI" /v "AllowEdgeSwipe" /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v "AllowEdgeSwipe" /t REG_DWORD /d 0 /f >nul 2>&1

echo - Khoa phim dinh tro nang (Shift 5 lan Sticky Keys)...
reg add "HKCU\Control Panel\Accessibility\StickyKeys" /v "Flags" /t REG_SZ /d "506" /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\Keyboard Response" /v "Flags" /t REG_SZ /d "122" /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\ToggleKeys" /v "Flags" /t REG_SZ /d "58" /f >nul 2>&1

echo - Chan AutoPlay khi cam USB va chan thong bao Windows...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\AutoplayHandlers" /v "DisableAutoplay" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoDriveTypeAutoRun" /t REG_DWORD /d 255 /f >nul 2>&1
reg add "HKCU\Software\Policies\Microsoft\Windows\CurrentVersion\PushNotifications" /v "NoToastApplicationNotification" /t REG_DWORD /d 1 /f >nul 2>&1

:: Tai nap Windows Explorer de ap dung ngay lap tuc NoWinKeys
echo ==> Dang nap lai Windows Explorer de ap dung chinh sach NoWinKeys ngay lap tuc...
taskkill /f /im explorer.exe >nul 2>&1
start explorer.exe >nul 2>&1
timeout /t 1 >nul

:: 6. Thiet lap phan quyen NTFS chong xoa tep
echo.
echo [BUOC 5/6] THIET LAP PHAN QUYEN NTFS CHONG NGUOI DUNG XOA TEP
echo ----------------------------------------------------------------------------
icacls "%KIOSK_DIR%" /inheritance:r /grant:r "SYSTEM":(OI)(CI)F /grant:r "Administrators":(OI)(CI)F /grant:r "Users":(OI)(CI)RX >nul 2>&1
icacls "%KIOSK_DIR%\*.*" /inheritance:r /grant:r "SYSTEM":F /grant:r "Administrators":F /grant:r "Users":RX >nul 2>&1
echo ==> Da khoa quyen NTFS: Nguoi dung thong thuong bi cam xoa hoac sua tep Kiosk.

:: 7. Dang ky tu dong khoi dong cung Windows
echo.
echo [BUOC 6/6] DANG KY TU DONG KHOI DONG CUNG WINDOWS
echo ----------------------------------------------------------------------------
schtasks /create /tn "QLBS_Kiosk_Service" /tr "wscript.exe "%KIOSK_DIR%\chay_ngam.vbs"" /sc onlogon /rl highest /f >nul 2>&1
reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v "QLBS_Kiosk_Service" /t REG_SZ /d "wscript.exe "%KIOSK_DIR%\chay_ngam.vbs"" /f >nul 2>&1

set "USER_STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%USER_STARTUP%\chay_kiosk_phong_kham.bat" del /f /q "%USER_STARTUP%\chay_kiosk_phong_kham.bat" >nul 2>&1

echo ==> Dang khoi chay man hinh Kiosk phong kham %ROOM_CODE% ngay bay gio...
wscript.exe "%KIOSK_DIR%\chay_ngam.vbs"

echo.
echo ============================================================================
echo   [HOAN TAT THANH CONG] KIOSK PHONG KHAM DA DUOC CAI DAT VA BAO VE TOAN DIEN!
echo ============================================================================
echo  - Man hinh Kiosk dang chay o che do toan man hinh (Fullscreen).
echo  - Da chan triet de thong bao Translate to English cua Edge/Chrome.
echo  - Ban phim da duoc khoa toan dien (Win+D, Win+R, Task Manager Ctrl+Shift+Esc).
echo  - Khi mo khoa (bac si quet mat hoac PIN IT), Kiosk se tu dong dong ngay lap tuc
echo    de giai phong 100%% Desktop cho bac si su dung HIS, PACS, Word muot ma.
echo  - Tren Desktop da tao san bieu tuong: KHOA_PHONG_KHAM.bat de khoa may khi can.
echo  - Khi het ca truc va qua thoi gian an han, Kiosk se tu dong bat lai toan man hinh.
echo  - Khi IT can go bo de bao tri, hay chay file: go_bo_kiosk.bat (Run as admin).
echo ============================================================================
echo.
pause