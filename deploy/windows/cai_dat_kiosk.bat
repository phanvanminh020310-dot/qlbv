@echo off
setlocal DisableDelayedExpansion
title QLBS Kiosk - Cai dat may tram phong kham

rem Site-specific package: the reviewed public certificate, SHA-256 pin, origin and
rem room are beside this BAT. It is trusted locally before native Kiosk preflight;
rem this never weakens Windows TLS validation or downloads a certificate from LAN.
if exist "%~dp0QLBS_Kiosk_Install.ini" goto SITE_PACKAGE

rem Generic developer/release package. Prefer the release EXE; compile locally only if absent.
rem GUI: double-click this BAT or QLBS_Kiosk.exe.
rem Fleet: cai_dat_kiosk.bat /server https://qlbv.benhvien.vn /room PK01 /quiet /no-start
set "KIOSK_EXE=%~dp0QLBS_Kiosk.exe"
if exist "%KIOSK_EXE%" goto RUN
if not exist "%~dp0QLBS_Kiosk.cs" (
    echo [LOI] Can QLBS_Kiosk.exe hoac QLBS_Kiosk.cs cung thu muc.
    exit /b 1
)

set "CSC="
if exist "%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" set "CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not defined CSC if exist "%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe" set "CSC=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not defined CSC (
    echo [LOI] Can .NET Framework 4.x tren Windows 10/11. Khuyen nghi .NET 4.8.
    exit /b 1
)

rem Use a local temporary directory so source-only installation also works from a read-only USB/share.
set "COMPILE_DIR=%TEMP%\QLBS_Kiosk_%RANDOM%_%RANDOM%"
mkdir "%COMPILE_DIR%" >nul 2>&1
if not exist "%COMPILE_DIR%" (
    echo [LOI] Khong tao duoc thu muc bien dich tam.
    exit /b 1
)
set "KIOSK_EXE=%COMPILE_DIR%\QLBS_Kiosk.exe"
echo Dang bien dich ung dung WinForms doc lap...
"%CSC%" /nologo /codepage:65001 /target:winexe /platform:anycpu /optimize+ /warnaserror+ /out:"%KIOSK_EXE%" /reference:System.dll,System.Core.dll,System.Drawing.dll,System.Windows.Forms.dll,System.Web.Extensions.dll "%~dp0QLBS_Kiosk.cs"
if errorlevel 1 (
    echo [LOI] Bien dich that bai. Khong thay doi ban cai dat dang hoat dong.
    exit /b 1
)

:RUN
if "%~1"=="" goto GUI
rem The EXE validates arguments, preflights the server, requests UAC if needed, and installs atomically.
start "" /wait "%KIOSK_EXE%" /install %*
exit /b %errorlevel%

:GUI
start "" /wait "%KIOSK_EXE%" /setup
exit /b %errorlevel%

:SITE_PACKAGE
if not exist "%~dp0cai_dat_kiosk.ps1" (
    echo [LOI] Goi cai dat noi bo bi thieu cai_dat_kiosk.ps1. Khong cai dat de tranh tin chung chi khong duoc kiem tra.
    exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0cai_dat_kiosk.ps1"
exit /b %errorlevel%
