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
powershell -NoProfile -ExecutionPolicy Bypass -Command "$b=[System.Convert]::FromBase64String('QWRkLVR5cGUgQCIKdXNpbmcgU3lzdGVtOwp1c2luZyBTeXN0ZW0uUnVudGltZS5JbnRlcm9wU2VydmljZXM7CnB1YmxpYyBjbGFzcyBXIHsKICAgIFtEbGxJbXBvcnQoInVzZXIzMi5kbGwiKV0gcHVibGljIHN0YXRpYyBleHRlcm4gYm9vbCBTaG93V2luZG93QXN5bmMoSW50UHRyIGgsIGludCBjKTsKICAgIFtEbGxJbXBvcnQoInVzZXIzMi5kbGwiKV0gcHVibGljIHN0YXRpYyBleHRlcm4gYm9vbCBTZXRGb3JlZ3JvdW5kV2luZG93KEludFB0ciBoKTsKICAgIFtEbGxJbXBvcnQoInVzZXIzMi5kbGwiKV0gcHVibGljIHN0YXRpYyBleHRlcm4gYm9vbCBJc0ljb25pYyhJbnRQdHIgaCk7Cn0KIkAKCiRLaW9za0RpciA9ICJDOlxQcm9ncmFtRGF0YVxRTEJTX0tpb3NrIgokQ29uZmlnRmlsZSA9IEpvaW4tUGF0aCAkS2lvc2tEaXIgImNvbmZpZy50eHQiCmlmICgtbm90IChUZXN0LVBhdGggJENvbmZpZ0ZpbGUpKSB7IGV4aXQgMSB9CgokY2ZnID0gQHt9CkdldC1Db250ZW50ICRDb25maWdGaWxlIHwgRm9yRWFjaC1PYmplY3QgewogICAgaWYgKCRfIC1tYXRjaCAiXihbXj1dKyk9KC4qKSQiKSB7ICRjZmdbJG1hdGNoZXNbMV0uVHJpbSgpXSA9ICRtYXRjaGVzWzJdLlRyaW0oKSB9Cn0KCiRTZXJ2ZXJJcCA9ICRjZmdbIlNFUlZFUl9JUCJdCiRQb3J0ID0gJGNmZ1siUE9SVCJdCiRSb29tQ29kZSA9ICRjZmdbIlJPT01fQ09ERSJdCiRCcm93c2VyRXhlID0gJGNmZ1siQlJPV1NFUl9QQVRIIl0KJEtpb3NrVXJsID0gImh0dHA6Ly8iICsgJFNlcnZlcklwICsgIjoiICsgJFBvcnQgKyAiL2tpb3NrLyIgKyAkUm9vbUNvZGUKJFN0YXR1c1VybCA9ICJodHRwOi8vIiArICRTZXJ2ZXJJcCArICI6IiArICRQb3J0ICsgIi9hcGkva2lvc2svc3RhdHVzP3Jvb21Db2RlPSIgKyAkUm9vbUNvZGUKCmZ1bmN0aW9uIExhdW5jaC1LaW9zayB7CiAgICAkYXJnc0xpc3QgPSBAKAogICAgICAgICItLWtpb3NrIiwKICAgICAgICAkS2lvc2tVcmwsCiAgICAgICAgIi0tZWRnZS1raW9zay10eXBlPWZ1bGxzY3JlZW4iLAogICAgICAgICItLW5vLWZpcnN0LXJ1biIsCiAgICAgICAgIi0tbm8tZGVmYXVsdC1icm93c2VyLWNoZWNrIiwKICAgICAgICAiLS1kaXNhYmxlLXBpbmNoIiwKICAgICAgICAiLS1vdmVyc2Nyb2xsLWhpc3RvcnktbmF2aWdhdGlvbj0wIiwKICAgICAgICAiLS1kaXNhYmxlLWZlYXR1cmVzPVRyYW5zbGF0ZVVJIgogICAgKQogICAgU3RhcnQtUHJvY2VzcyAtRmlsZVBhdGggJEJyb3dzZXJFeGUgLUFyZ3VtZW50TGlzdCAkYXJnc0xpc3QKfQoKZnVuY3Rpb24gR2V0LUtpb3NrUHJvY2VzcyB7CiAgICBHZXQtUHJvY2VzcyAtTmFtZSBtc2VkZ2UsIGNocm9tZSAtRXJyb3JBY3Rpb24gU2lsZW50bHlDb250aW51ZSB8IFdoZXJlLU9iamVjdCB7ICRfLk1haW5XaW5kb3dIYW5kbGUgLW5lIFtJbnRQdHJdOjpaZXJvIH0KfQoKTGF1bmNoLUtpb3NrClN0YXJ0LVNsZWVwIC1TZWNvbmRzIDMKCiRsYXN0VW5sb2NrZWQgPSAkZmFsc2UKCndoaWxlICgkdHJ1ZSkgewogICAgdHJ5IHsKICAgICAgICAkcmVzcCA9IEludm9rZS1SZXN0TWV0aG9kIC1VcmkgJFN0YXR1c1VybCAtTWV0aG9kIEdldCAtVGltZW91dFNlYyAyIC1FcnJvckFjdGlvbiBTdG9wCiAgICAgICAgJGlzVW5sb2NrZWQgPSBbYm9vbF0kcmVzcC5pc1VubG9ja2VkCgogICAgICAgICRwcm9jcyA9IEdldC1LaW9za1Byb2Nlc3MKICAgICAgICBpZiAoLW5vdCAkcHJvY3MpIHsKICAgICAgICAgICAgaWYgKC1ub3QgJGlzVW5sb2NrZWQpIHsKICAgICAgICAgICAgICAgIExhdW5jaC1LaW9zawogICAgICAgICAgICAgICAgU3RhcnQtU2xlZXAgLVNlY29uZHMgMgogICAgICAgICAgICB9CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgJG1haW5Qcm9jID0gJHByb2NzIHwgU2VsZWN0LU9iamVjdCAtRmlyc3QgMQogICAgICAgICAgICAkaHduZCA9ICRtYWluUHJvYy5NYWluV2luZG93SGFuZGxlCgogICAgICAgICAgICBpZiAoJGlzVW5sb2NrZWQgLWFuZCAtbm90ICRsYXN0VW5sb2NrZWQpIHsKICAgICAgICAgICAgICAgIGlmICgkaHduZCAtbmUgW0ludFB0cl06Olplcm8pIHsKICAgICAgICAgICAgICAgICAgICBbV106OlNob3dXaW5kb3dBc3luYygkaHduZCwgNikgfCBPdXQtTnVsbAogICAgICAgICAgICAgICAgICAgIFtXXTo6U2hvd1dpbmRvd0FzeW5jKCRod25kLCAyKSB8IE91dC1OdWxsCiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAkbGFzdFVubG9ja2VkID0gJHRydWUKICAgICAgICAgICAgfSBlbHNlaWYgKC1ub3QgJGlzVW5sb2NrZWQgLWFuZCAkbGFzdFVubG9ja2VkKSB7CiAgICAgICAgICAgICAgICBpZiAoJGh3bmQgLW5lIFtJbnRQdHJdOjpaZXJvKSB7CiAgICAgICAgICAgICAgICAgICAgW1ddOjpTaG93V2luZG93QXN5bmMoJGh3bmQsIDMpIHwgT3V0LU51bGwKICAgICAgICAgICAgICAgICAgICBbV106OlNldEZvcmVncm91bmRXaW5kb3coJGh3bmQpIHwgT3V0LU51bGwKICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgTGF1bmNoLUtpb3NrCiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAkbGFzdFVubG9ja2VkID0gJGZhbHNlCiAgICAgICAgICAgIH0gZWxzZWlmICgtbm90ICRpc1VubG9ja2VkKSB7CiAgICAgICAgICAgICAgICBpZiAoJGh3bmQgLW5lIFtJbnRQdHJdOjpaZXJvIC1hbmQgW1ddOjpJc0ljb25pYygkaHduZCkpIHsKICAgICAgICAgICAgICAgICAgICBbV106OlNob3dXaW5kb3dBc3luYygkaHduZCwgMykgfCBPdXQtTnVsbAogICAgICAgICAgICAgICAgICAgIFtXXTo6U2V0Rm9yZWdyb3VuZFdpbmRvdygkaHduZCkgfCBPdXQtTnVsbAogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfQogICAgfSBjYXRjaCB7fQogICAgU3RhcnQtU2xlZXAgLVNlY29uZHMgMgp9'); [System.IO.File]::WriteAllBytes('%KIOSK_DIR%\kiosk_supervisor.ps1', $b)"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$b=[System.Convert]::FromBase64String('U2V0IFdzaFNoZWxsID0gQ3JlYXRlT2JqZWN0KCJXU2NyaXB0LlNoZWxsIikNCldzaFNoZWxsLlJ1biAicG93ZXJzaGVsbC5leGUgLUV4ZWN1dGlvblBvbGljeSBCeXBhc3MgLVdpbmRvd1N0eWxlIEhpZGRlbiAtRmlsZSAiIkM6XFByb2dyYW1EYXRhXFFMQlNfS2lvc2tca2lvc2tfc3VwZXJ2aXNvci5wczEiIiIsIDAsIEZhbHNl'); [System.IO.File]::WriteAllBytes('%KIOSK_DIR%\chay_ngam.vbs', $b)"

:: 5. Khoa ban phim va chinh sach an ninh Kiosk
echo.
echo [BUOC 4/6] KHOA BAN PHIM VA CHINH SACH AN NINH KIOSK
echo ----------------------------------------------------------------------------
echo - Khoa phim Windows va to hop Win+D, Win+R...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoWinKeys" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoRun" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoWinKeys" /t REG_DWORD /d 1 /f >nul 2>&1

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
echo  - Ban phim da duoc khoa toan dien (Win+D, Win+R, Task Manager Ctrl+Shift+Esc).
echo  - Khi bac si quet mat mo khoa, Kiosk se tu dong thu nho xuong Taskbar
echo    de giai phong 100%% Desktop cho bac si su dung HIS, PACS, Word muot ma.
echo  - Khi het ca truc va qua thoi gian an han, Kiosk se tu dong phong to khoa lai.
echo  - Khi IT can go bo de bao tri, hay chay file: go_bo_kiosk.bat (Run as admin).
echo ============================================================================
echo.
pause