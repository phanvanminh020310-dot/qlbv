@echo off
setlocal DisableDelayedExpansion
title QLBS Kiosk - Go bo va cuu ho CNTT

rem Fallback remains usable even when the application or its config is damaged.
rem Optional flags: /quiet (no prompt), /purge (remove the preserved terminal configuration).
set "QLBS_REMOVE_SELF=%~f0"
set "QLBS_REMOVE_FLAGS="
set "QLBS_REMOVE_QUIET=0"
set "QLBS_REMOVE_PURGE=0"
:ARGS
if "%~1"=="" goto CHECK_ADMIN
if /i "%~1"=="/quiet" goto QUIET
if /i "%~1"=="/purge" goto PURGE
echo [LOI] Tham so khong hop le: %~1
exit /b 1
:QUIET
set "QLBS_REMOVE_QUIET=1"
set "QLBS_REMOVE_FLAGS=%QLBS_REMOVE_FLAGS% /quiet"
shift
goto ARGS
:PURGE
set "QLBS_REMOVE_PURGE=1"
set "QLBS_REMOVE_FLAGS=%QLBS_REMOVE_FLAGS% /purge"
shift
goto ARGS

:CHECK_ADMIN
powershell -NoProfile -NonInteractive -Command "if ((New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }"
if not errorlevel 1 goto CONFIRM
if "%QLBS_REMOVE_QUIET%"=="1" (
    echo [LOI] Go bo im lang can quyen Administrator hoac SYSTEM.
    exit /b 1
)
powershell -NoProfile -Command "try { $a = @{FilePath=$env:QLBS_REMOVE_SELF; Verb='RunAs'; Wait=$true; PassThru=$true}; if ($env:QLBS_REMOVE_FLAGS) { $a.ArgumentList=$env:QLBS_REMOVE_FLAGS }; $p = Start-Process @a; exit $p.ExitCode } catch { exit 1 }"
exit /b %errorlevel%

:CONFIRM
if "%QLBS_REMOVE_QUIET%"=="1" goto REMOVE
echo.
echo QLBS Kiosk se ngung bao ve may tram. Chi CNTT co quyen Administrator moi duoc go bo.
echo Khong dung HIS, khong dong cac tab Edge/Chrome thong thuong.
echo Cau hinh duoc giu lai neu khong truyen /purge.
choice /c YN /n /m "Tiep tuc go bo? [Y/N]: "
if errorlevel 2 exit /b 2

:REMOVE
rem The recovery implementation is embedded below, so this remains exactly one BAT file.
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$text = [IO.File]::ReadAllText($env:QLBS_REMOVE_SELF); $marker = '#--QLBS-RECOVERY-POWERSHELL--'; $script = $text.Substring($text.LastIndexOf($marker) + $marker.Length); & ([ScriptBlock]::Create($script))"
set "RESULT=%errorlevel%"
if not "%RESULT%"=="0" (
    echo [LOI] Go bo chua hoan tat. Xem loi ben tren, khong xoa cau hinh thu cong.
    exit /b %RESULT%
)
echo [OK] Da go bo Kiosk. HIS va cac ung dung khac duoc giu nguyen.
if "%QLBS_REMOVE_QUIET%"=="0" pause
exit /b 0

#--QLBS-RECOVERY-POWERSHELL--
$ErrorActionPreference = 'Stop'
$setupMutex = $null
$ownsMutex = $false
try {
    $setupMutex = [Threading.Mutex]::new($true, 'Global\QLBS_Kiosk_Setup_v2', [ref]$ownsMutex)
    if (-not $ownsMutex) { throw 'Another Kiosk install/uninstall is already running.' }
    $programFiles = [Environment]::GetFolderPath('ProgramFiles')
    if ($env:ProgramW6432) { $programFiles = $env:ProgramW6432 }
    $install = Join-Path $programFiles 'QLBS Kiosk'
    $legacy = 'C:\QLBS_Kiosk'
    $data = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'QLBS\Kiosk'
    $runKeys = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run')
    $legacyDataOwned = (Test-Path -LiteralPath (Join-Path $legacy 'QLBS_Kiosk_Agent.exe')) -or (Test-Path -LiteralPath (Join-Path $legacy 'QLBS_Kiosk_Agent.exe.retired')) -or (Test-Path -LiteralPath (Join-Path $legacy 'config.ini'))
    $hasLegacy = (Test-Path -LiteralPath (Join-Path $legacy 'QLBS_Kiosk_Agent.exe')) -or ((Test-Path -LiteralPath (Join-Path $legacy 'config.ini')) -and -not (Test-Path -LiteralPath (Join-Path $data 'legacy-migrated.flag')))
    foreach ($key in $runKeys) {
        if ((Get-ItemProperty -LiteralPath $key -Name QLBS_Kiosk_Agent -ErrorAction SilentlyContinue)) { $hasLegacy = $true }
    }
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -in @('QLBS_Kiosk.exe', 'QLBS_Kiosk_Agent.exe') -and $_.ExecutablePath -and
        ($_.ExecutablePath.StartsWith($install + '\', [StringComparison]::OrdinalIgnoreCase) -or $_.ExecutablePath.StartsWith($legacy + '\', [StringComparison]::OrdinalIgnoreCase))
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
        Wait-Process -Id $_.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
    }
    Remove-ItemProperty -LiteralPath $runKeys[0] -Name QLBS_Kiosk -ErrorAction SilentlyContinue
    $restartExplorer = $false
    if ($hasLegacy) {
        $null = & cmd.exe /d /c 'schtasks.exe /delete /tn QLBS_Kiosk_Agent /f >nul 2>&1'
        foreach ($root in @('HKLM:', 'HKCU:')) {
            Remove-ItemProperty -LiteralPath "$root\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name QLBS_Kiosk_Agent -ErrorAction SilentlyContinue
            foreach ($path in @('Software\Microsoft\Windows\CurrentVersion\Policies\Explorer', 'Software\Policies\Microsoft\Windows\Explorer')) {
                $value = Get-ItemProperty -LiteralPath "$root\$path" -Name NoWinKeys -ErrorAction SilentlyContinue
                if ($value -and $value.NoWinKeys -eq 1) { $restartExplorer = $true }
                Remove-ItemProperty -LiteralPath "$root\$path" -Name NoWinKeys -ErrorAction SilentlyContinue
            }
            foreach ($name in @('DisableTaskMgr', 'DisableLockWorkstation')) {
                Remove-ItemProperty -LiteralPath "$root\Software\Microsoft\Windows\CurrentVersion\Policies\System" -Name $name -ErrorAction SilentlyContinue
            }
            foreach ($browser in @('Microsoft\Edge', 'Google\Chrome')) {
                Remove-ItemProperty -LiteralPath "$root\SOFTWARE\Policies\$browser" -Name DeveloperToolsAvailability -ErrorAction SilentlyContinue
            }
        }
        $startup = Join-Path ([Environment]::GetFolderPath('CommonStartup')) 'QLBS_Kiosk_Agent.bat'
        Remove-Item -LiteralPath $startup -Force -ErrorAction SilentlyContinue
        Get-CimInstance Win32_Process | Where-Object {
            $_.Name -in @('msedge.exe', 'chrome.exe') -and $_.CommandLine -like '*QLBS_Kiosk*EdgeProfile*' -and $_.CommandLine -like '*--kiosk*'
        } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    }
    Remove-Item -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QLBS_Kiosk' -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $install) { Remove-Item -LiteralPath $install -Recurse -Force }
    if ($env:QLBS_REMOVE_PURGE -eq '1') {
        if (Test-Path -LiteralPath $data) { Remove-Item -LiteralPath $data -Recurse -Force }
        if ($legacyDataOwned -and (Test-Path -LiteralPath $legacy)) { Remove-Item -LiteralPath $legacy -Recurse -Force }
    }
    if ($restartExplorer) {
        $session = (Get-Process -Id $PID).SessionId
        if ($session -ne 0) {
            Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $session } | Stop-Process -Force
            Start-Process explorer.exe
        } else { Write-Host 'Legacy Explorer policy was removed. Users must sign out/in to refresh cached policies.' }
    }
    exit 0
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    if ($ownsMutex -and $setupMutex) { $setupMutex.ReleaseMutex() }
    if ($setupMutex) { $setupMutex.Dispose() }
}
