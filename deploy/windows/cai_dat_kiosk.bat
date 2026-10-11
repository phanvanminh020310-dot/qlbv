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
powershell -NoProfile -ExecutionPolicy Bypass -Command "$b=[System.Convert]::FromBase64String('QWRkLVR5cGUgQCIKdXNpbmcgU3lzdGVtOwp1c2luZyBTeXN0ZW0uUnVudGltZS5JbnRlcm9wU2VydmljZXM7CnB1YmxpYyBjbGFzcyBXIHsKICAgIFtEbGxJbXBvcnQoInVzZXIzMi5kbGwiKV0gcHVibGljIHN0YXRpYyBleHRlcm4gYm9vbCBTaG93V2luZG93QXN5bmMoSW50UHRyIGgsIGludCBjKTsKICAgIFtEbGxJbXBvcnQoInVzZXIzMi5kbGwiKV0gcHVibGljIHN0YXRpYyBleHRlcm4gYm9vbCBTZXRGb3JlZ3JvdW5kV2luZG93KEludFB0ciBoKTsKICAgIFtEbGxJbXBvcnQoInVzZXIzMi5kbGwiKV0gcHVibGljIHN0YXRpYyBleHRlcm4gYm9vbCBJc0ljb25pYyhJbnRQdHIgaCk7CiAgICBbRGxsSW1wb3J0KCJ1c2VyMzIuZGxsIildIHB1YmxpYyBzdGF0aWMgZXh0ZXJuIGJvb2wgSXNXaW5kb3dWaXNpYmxlKEludFB0ciBoKTsKfQoiQAoKJEtpb3NrRGlyID0gIkM6XFByb2dyYW1EYXRhXFFMQlNfS2lvc2siCiRDb25maWdGaWxlID0gSm9pbi1QYXRoICRLaW9za0RpciAiY29uZmlnLnR4dCIKCmZ1bmN0aW9uIEdldC1Db25maWcgewogICAgaWYgKC1ub3QgKFRlc3QtUGF0aCAkQ29uZmlnRmlsZSkpIHsgcmV0dXJuICRudWxsIH0KICAgICRjZmcgPSBAe30KICAgIEdldC1Db250ZW50ICRDb25maWdGaWxlIHwgRm9yRWFjaC1PYmplY3QgewogICAgICAgIGlmICgkXyAtbWF0Y2ggIl4oW149XSspPSguKikkIikgeyAkY2ZnWyRtYXRjaGVzWzFdLlRyaW0oKV0gPSAkbWF0Y2hlc1syXS5UcmltKCkgfQogICAgfQogICAgcmV0dXJuICRjZmcKfQoKJGNmZyA9IEdldC1Db25maWcKaWYgKC1ub3QgJGNmZykgeyBleGl0IDAgfQoKJFNlcnZlcklwID0gJGNmZ1siU0VSVkVSX0lQIl0KJFBvcnQgPSAkY2ZnWyJQT1JUIl0KJFJvb21Db2RlID0gJGNmZ1siUk9PTV9DT0RFIl0KJEJyb3dzZXJFeGUgPSAkY2ZnWyJCUk9XU0VSX1BBVEgiXQokS2lvc2tVcmwgPSAiaHR0cDovLyIgKyAkU2VydmVySXAgKyAiOiIgKyAkUG9ydCArICIva2lvc2svIiArICRSb29tQ29kZQokU3RhdHVzVXJsID0gImh0dHA6Ly8iICsgJFNlcnZlcklwICsgIjoiICsgJFBvcnQgKyAiL2FwaS9raW9zay9zdGF0dXM/cm9vbUNvZGU9IiArICRSb29tQ29kZQoKJHNjcmlwdDpLaW9za1Byb2NJZCA9IDAKJHNjcmlwdDpLaW9za0h3bmQgPSBbSW50UHRyXTo6WmVybwoKZnVuY3Rpb24gTGF1bmNoLUtpb3NrIHsKICAgICRhcmdzTGlzdCA9IEAoCiAgICAgICAgIi0ta2lvc2siLAogICAgICAgICRLaW9za1VybCwKICAgICAgICAiLS1lZGdlLWtpb3NrLXR5cGU9ZnVsbHNjcmVlbiIsCiAgICAgICAgIi0tbm8tZmlyc3QtcnVuIiwKICAgICAgICAiLS1uby1kZWZhdWx0LWJyb3dzZXItY2hlY2siLAogICAgICAgICItLWRpc2FibGUtZmVhdHVyZXM9VHJhbnNsYXRlLFRyYW5zbGF0ZVVJLE9wdGltaXphdGlvbkhpbnRzLE1lZGlhUm91dGVyIiwKICAgICAgICAiLS1kaXNhYmxlLXRyYW5zbGF0ZSIsCiAgICAgICAgIi0tbGFuZz12aS1WTiIsCiAgICAgICAgIi0tZGlzYWJsZS1waW5jaCIsCiAgICAgICAgIi0tb3ZlcnNjcm9sbC1oaXN0b3J5LW5hdmlnYXRpb249MCIKICAgICkKICAgICRwcm9jID0gU3RhcnQtUHJvY2VzcyAtRmlsZVBhdGggJEJyb3dzZXJFeGUgLUFyZ3VtZW50TGlzdCAkYXJnc0xpc3QgLVBhc3NUaHJ1CiAgICAkc2NyaXB0Oktpb3NrUHJvY0lkID0gJHByb2MuSWQKICAgIAogICAgZm9yICgkaSA9IDA7ICRpIC1sdCAxMjsgJGkrKykgewogICAgICAgIFN0YXJ0LVNsZWVwIC1NaWxsaXNlY29uZHMgNDAwCiAgICAgICAgJGZvdW5kID0gR2V0LVByb2Nlc3MgLU5hbWUgbXNlZGdlLCBjaHJvbWUgLUVycm9yQWN0aW9uIFNpbGVudGx5Q29udGludWUgfCBXaGVyZS1PYmplY3QgeyAkXy5NYWluV2luZG93SGFuZGxlIC1uZSBbSW50UHRyXTo6WmVybyB9IHwgU2VsZWN0LU9iamVjdCAtRmlyc3QgMQogICAgICAgIGlmICgkZm91bmQpIHsKICAgICAgICAgICAgJHNjcmlwdDpLaW9za0h3bmQgPSAkZm91bmQuTWFpbldpbmRvd0hhbmRsZQogICAgICAgICAgICBicmVhawogICAgICAgIH0KICAgIH0KfQoKZnVuY3Rpb24gRmluZC1LaW9za0h3bmQgewogICAgaWYgKCRzY3JpcHQ6S2lvc2tId25kIC1uZSBbSW50UHRyXTo6WmVybykgewogICAgICAgIHJldHVybiAkc2NyaXB0Oktpb3NrSHduZAogICAgfQogICAgJGZvdW5kID0gR2V0LVByb2Nlc3MgLU5hbWUgbXNlZGdlLCBjaHJvbWUgLUVycm9yQWN0aW9uIFNpbGVudGx5Q29udGludWUgfCBXaGVyZS1PYmplY3QgeyAkXy5NYWluV2luZG93SGFuZGxlIC1uZSBbSW50UHRyXTo6WmVybyB9IHwgU2VsZWN0LU9iamVjdCAtRmlyc3QgMQogICAgaWYgKCRmb3VuZCkgewogICAgICAgICRzY3JpcHQ6S2lvc2tId25kID0gJGZvdW5kLk1haW5XaW5kb3dIYW5kbGUKICAgICAgICByZXR1cm4gJHNjcmlwdDpLaW9za0h3bmQKICAgIH0KICAgIHJldHVybiBbSW50UHRyXTo6WmVybwp9CgpMYXVuY2gtS2lvc2sKU3RhcnQtU2xlZXAgLVNlY29uZHMgMgoKJGxhc3RVbmxvY2tlZCA9ICRmYWxzZQoKd2hpbGUgKCR0cnVlKSB7CiAgICAjIE5ldSBjb25maWcudHh0IGJpIHhvYSAoa2hpIGdvIGJvIEtpb3NrKSAtPiBUaG9hdCBuZ2F5IGxhcCB0dWMKICAgIGlmICgtbm90IChUZXN0LVBhdGggJENvbmZpZ0ZpbGUpKSB7CiAgICAgICAgYnJlYWsKICAgIH0KCiAgICB0cnkgewogICAgICAgICRyZXNwID0gSW52b2tlLVJlc3RNZXRob2QgLVVyaSAkU3RhdHVzVXJsIC1NZXRob2QgR2V0IC1UaW1lb3V0U2VjIDIgLUVycm9yQWN0aW9uIFN0b3AKICAgICAgICAkZGF0YSA9ICRyZXNwCiAgICAgICAgaWYgKCRyZXNwIC1hbmQgJHJlc3AuZGF0YSAtbmUgJG51bGwpIHsKICAgICAgICAgICAgJGRhdGEgPSAkcmVzcC5kYXRhCiAgICAgICAgfQogICAgICAgICRpc1VubG9ja2VkID0gW2Jvb2xdJGRhdGEuaXNVbmxvY2tlZAoKICAgICAgICAkaHduZCA9IEZpbmQtS2lvc2tId25kCgogICAgICAgICMgS2llbSB0cmEgdGllbiB0cmluaCB0cmluaCBkdXlldCBjb24gc29uZyBraG9uZwogICAgICAgICRhbGl2ZVByb2NzID0gR2V0LVByb2Nlc3MgLU5hbWUgbXNlZGdlLCBjaHJvbWUgLUVycm9yQWN0aW9uIFNpbGVudGx5Q29udGludWUKICAgICAgICBpZiAoLW5vdCAkYWxpdmVQcm9jcykgewogICAgICAgICAgICBpZiAoLW5vdCAkaXNVbmxvY2tlZCkgewogICAgICAgICAgICAgICAgTGF1bmNoLUtpb3NrCiAgICAgICAgICAgICAgICBTdGFydC1TbGVlcCAtU2Vjb25kcyAyCiAgICAgICAgICAgIH0KICAgICAgICB9IGVsc2UgewogICAgICAgICAgICBpZiAoJGlzVW5sb2NrZWQgLWFuZCAtbm90ICRsYXN0VW5sb2NrZWQpIHsKICAgICAgICAgICAgICAgICMgQmFjIHNpIHZ1YSBtbyBraG9hIC0+IFRodSBuaG8gJiBBbiBLaW9zayB4dW9uZyBUYXNrYmFyIGRlIGxvIDEwMCUgRGVza3RvcAogICAgICAgICAgICAgICAgaWYgKCRod25kIC1uZSBbSW50UHRyXTo6WmVybykgewogICAgICAgICAgICAgICAgICAgIFtXXTo6U2hvd1dpbmRvd0FzeW5jKCRod25kLCA2KSB8IE91dC1OdWxsICMgU1dfTUlOSU1JWkUKICAgICAgICAgICAgICAgICAgICBbV106OlNob3dXaW5kb3dBc3luYygkaHduZCwgMikgfCBPdXQtTnVsbCAjIFNXX1NIT1dNSU5JTUlaRUQKICAgICAgICAgICAgICAgICAgICBbV106OlNob3dXaW5kb3dBc3luYygkaHduZCwgMCkgfCBPdXQtTnVsbCAjIFNXX0hJREUKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICRsYXN0VW5sb2NrZWQgPSAkdHJ1ZQogICAgICAgICAgICB9IGVsc2VpZiAoLW5vdCAkaXNVbmxvY2tlZCAtYW5kICRsYXN0VW5sb2NrZWQpIHsKICAgICAgICAgICAgICAgICMgSGV0IGNhIHRydWMgKyBxdWEgdGhvaSBnaWFuIGFuIGhhbiAoaG9hYyBiYW0ga2hvYSkgLT4gSGllbiBsYWkgS2lvc2sgdG9hbiBtYW4gaGluaAogICAgICAgICAgICAgICAgaWYgKCRod25kIC1uZSBbSW50UHRyXTo6WmVybykgewogICAgICAgICAgICAgICAgICAgIFtXXTo6U2hvd1dpbmRvd0FzeW5jKCRod25kLCA1KSB8IE91dC1OdWxsICMgU1dfU0hPVwogICAgICAgICAgICAgICAgICAgIFtXXTo6U2hvd1dpbmRvd0FzeW5jKCRod25kLCAzKSB8IE91dC1OdWxsICMgU1dfTUFYSU1JWkUKICAgICAgICAgICAgICAgICAgICBbV106OlNldEZvcmVncm91bmRXaW5kb3coJGh3bmQpIHwgT3V0LU51bGwKICAgICAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICAgICAgTGF1bmNoLUtpb3NrCiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAkbGFzdFVubG9ja2VkID0gJGZhbHNlCiAgICAgICAgICAgIH0gZWxzZWlmICgtbm90ICRpc1VubG9ja2VkKSB7CiAgICAgICAgICAgICAgICAjIFRyb25nIGx1YyBkYW5nIGtob2E6IE5ldSBiaSB0aHUgbmhvIGhvYWMgbWF0IHRpZXUgZGllbSAtPiBLaG9pIHBodWMgdG9hbiBtYW4gaGluaCBuZ2F5CiAgICAgICAgICAgICAgICBpZiAoJGh3bmQgLW5lIFtJbnRQdHJdOjpaZXJvKSB7CiAgICAgICAgICAgICAgICAgICAgaWYgKFtXXTo6SXNJY29uaWMoJGh3bmQpIC1vciAtbm90IFtXXTo6SXNXaW5kb3dWaXNpYmxlKCRod25kKSkgewogICAgICAgICAgICAgICAgICAgICAgICBbV106OlNob3dXaW5kb3dBc3luYygkaHduZCwgNSkgfCBPdXQtTnVsbAogICAgICAgICAgICAgICAgICAgICAgICBbV106OlNob3dXaW5kb3dBc3luYygkaHduZCwgMykgfCBPdXQtTnVsbAogICAgICAgICAgICAgICAgICAgICAgICBbV106OlNldEZvcmVncm91bmRXaW5kb3coJGh3bmQpIHwgT3V0LU51bGwKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICB9IGNhdGNoIHt9CiAgICBTdGFydC1TbGVlcCAtU2Vjb25kcyAxCn0='); [System.IO.File]::WriteAllBytes('%KIOSK_DIR%\kiosk_supervisor.ps1', $b)"
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
echo  - Khi mo khoa (bac si quet mat hoac PIN IT), Kiosk tu dong an va thu nho
echo    de giai phong 100%% Desktop cho bac si su dung HIS, PACS, Word muot ma.
echo  - Tren Desktop da tao san file: KHOA_PHONG_KHAM.bat de khoa may khi can.
echo  - Khi het ca truc va qua thoi gian an han, Kiosk se tu dong phong to khoa lai.
echo  - Khi IT can go bo de bao tri, hay chay file: go_bo_kiosk.bat (Run as admin).
echo ============================================================================
echo.
pause