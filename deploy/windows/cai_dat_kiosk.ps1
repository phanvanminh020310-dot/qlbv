[CmdletBinding()]
param(
    [switch]$VerifyOnly,
    [switch]$TrustLocalCertificate,
    [switch]$Elevated
)

# This installer intentionally never downloads or accepts a certificate from the network.
# A hospital IT administrator creates a site bundle containing the reviewed public
# certificate and its SHA-256 pin. That certificate is then trusted locally before
# the native Kiosk preflight uses ordinary Windows TLS validation.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Fail([string]$message) {
    Write-Host "[LOI] $message" -ForegroundColor Red
    exit 1
}

function Read-Ini([string]$path) {
    $values = @{}
    foreach ($line in [IO.File]::ReadAllLines($path, [Text.Encoding]::UTF8)) {
        $text = $line.Trim()
        if ($text.Length -eq 0 -or $text.StartsWith('#') -or $text.StartsWith(';')) { continue }
        $index = $text.IndexOf('=')
        if ($index -lt 1) { throw "Dong cau hinh khong hop le: $line" }
        $key = $text.Substring(0, $index).Trim().ToLowerInvariant()
        $value = $text.Substring($index + 1).Trim()
        if ($values.ContainsKey($key) -or $value.Length -eq 0) { throw "Cau hinh bi trung hoac rong: $key" }
        $values[$key] = $value
    }
    return $values
}

function Get-PublicCertificate([string]$path) {
    $raw = [IO.File]::ReadAllBytes($path)
    $text = [Text.Encoding]::ASCII.GetString($raw)
    if ($text.Contains('-----BEGIN CERTIFICATE-----')) {
        $body = [Text.RegularExpressions.Regex]::Replace($text, '-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s', '')
        $raw = [Convert]::FromBase64String($body)
    }
    return New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList (, $raw)
}

function Install-LocalTrustCertificate([Security.Cryptography.X509Certificates.X509Certificate2]$certificate, [string]$relaunchSwitch) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" {1} -Elevated' -f $PSCommandPath.Replace('"', '""'), $relaunchSwitch
        $child = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments -Wait -PassThru
        exit $child.ExitCode
    }

    $store = New-Object Security.Cryptography.X509Certificates.X509Store('Root', 'LocalMachine')
    $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    try {
        $alreadyTrusted = $store.Certificates | Where-Object { $_.Thumbprint -eq $certificate.Thumbprint } | Select-Object -First 1
        if ($null -eq $alreadyTrusted) {
            $store.Add($certificate)
            Write-Host '[OK] Da cai chung chi QLBV da kiem tra vao Trusted Root cua may tram.' -ForegroundColor Green
        } else {
            Write-Host '[OK] Chung chi QLBV da co trong Trusted Root cua may tram.' -ForegroundColor Green
        }
    } finally {
        $store.Close()
    }
}

if ($TrustLocalCertificate) {
    try {
        $certificatePath = Join-Path $root 'QLBS_Server_Trust.cer'
        if (-not (Test-Path -LiteralPath $certificatePath -PathType Leaf)) { Fail 'Khong tim thay QLBS_Server_Trust.cer trong thu muc bo cai.' }
        $certificate = Get-PublicCertificate $certificatePath
        if ($certificate.HasPrivateKey) { Fail 'Tep chung chi khong duoc chua private key/PFX.' }
        $now = [DateTime]::Now
        if ($certificate.NotBefore -gt $now -or $certificate.NotAfter -le $now) { Fail "Chung chi chua co hieu luc hoac da het han ($($certificate.NotAfter.ToString('yyyy-MM-dd')))." }
        if ($VerifyOnly) {
            Write-Host "[OK] Chung chi cuc bo hop le: $($certificate.Subject); SHA-256 $((Get-FileHash -LiteralPath $certificatePath -Algorithm SHA256).Hash.ToUpperInvariant())"
            exit 0
        }
        Install-LocalTrustCertificate $certificate '-TrustLocalCertificate'
        exit 0
    } catch {
        Fail $_.Exception.Message
    }
}

function Get-SiteBundle {
    $iniPath = Join-Path $root 'QLBS_Kiosk_Install.ini'
    if (-not (Test-Path -LiteralPath $iniPath -PathType Leaf)) {
        Fail 'Khong tim thay QLBS_Kiosk_Install.ini. Hay dung goi cai dat noi bo do CNTT tao, khong tu tai chung chi tu may chu.'
    }
    $cfg = Read-Ini $iniPath
    foreach ($key in @('server_url', 'room_code', 'certificate_file', 'certificate_sha256')) {
        if (-not $cfg.ContainsKey($key)) { Fail "Thieu $key trong QLBS_Kiosk_Install.ini." }
    }

    $uri = $null
    if (-not [Uri]::TryCreate($cfg.server_url, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https' -or $uri.UserInfo.Length -ne 0 -or $uri.Query.Length -ne 0 -or $uri.Fragment.Length -ne 0 -or $uri.AbsolutePath -ne '/') {
        Fail 'server_url phai la HTTPS origin, vi du https://172.16.13.75:3000.'
    }
    if ($cfg.room_code -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') { Fail 'room_code khong hop le.' }
    if ($cfg.certificate_file -match '[\\/:]' -or $cfg.certificate_file -match '^\.+$') { Fail 'certificate_file phai la ten tep trong goi cai dat.' }
    if ($cfg.certificate_sha256 -notmatch '^[A-Fa-f0-9]{64}$') { Fail 'certificate_sha256 phai co 64 ky tu hex.' }

    $certificatePath = Join-Path $root $cfg.certificate_file
    if (-not (Test-Path -LiteralPath $certificatePath -PathType Leaf)) { Fail "Khong tim thay chung chi $($cfg.certificate_file)." }
    $actualHash = (Get-FileHash -LiteralPath $certificatePath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actualHash -ne $cfg.certificate_sha256.ToUpperInvariant()) { Fail 'SHA-256 cua chung chi khong khop goi cai dat. Dung cai dat de tranh tin chung chi da bi thay the.' }

    try { $certificate = Get-PublicCertificate $certificatePath }
    catch { Fail "Khong doc duoc chung chi cong khai: $($_.Exception.Message)" }
    if ($certificate.HasPrivateKey) { Fail 'Tep chung chi khong duoc chua private key/PFX.' }
    $now = [DateTime]::Now
    if ($certificate.NotBefore -gt $now -or $certificate.NotAfter -le $now) { Fail "Chung chi chua co hieu luc hoac da het han ($($certificate.NotAfter.ToString('yyyy-MM-dd')))." }
    $san = $certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.17' } | Select-Object -First 1
    if ($null -eq $san -or $san.Format($false).IndexOf($uri.Host, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        Fail "Chung chi khong co SAN khop dia chi may chu $($uri.Host)."
    }

    return [PSCustomObject]@{
        ServerUrl = $uri.GetLeftPart([UriPartial]::Authority)
        RoomCode = $cfg.room_code.ToUpperInvariant()
        CertificatePath = $certificatePath
        Certificate = $certificate
        CertificateHash = $actualHash
    }
}

try {
    $bundle = Get-SiteBundle
    $exe = Join-Path $root 'QLBS_Kiosk.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { Fail 'Khong tim thay QLBS_Kiosk.exe trong goi cai dat.' }

    if ($VerifyOnly) {
        Write-Host "[OK] Goi hop le: $($bundle.ServerUrl), phong $($bundle.RoomCode), SHA-256 chung chi $($bundle.CertificateHash)"
        exit 0
    }

    Install-LocalTrustCertificate $bundle.Certificate ''

    Write-Host "Dang kiem tra va cai QLBS Kiosk cho phong $($bundle.RoomCode)..."
    $install = Start-Process -FilePath $exe -ArgumentList @('/install', '/server', $bundle.ServerUrl, '/room', $bundle.RoomCode) -Wait -PassThru
    if ($install.ExitCode -ne 0) { Fail "QLBS Kiosk chua cai dat thanh cong (ma loi $($install.ExitCode)). Chung chi da duoc cai; kiem tra lai mang, cong HTTPS va ma phong." }
    Write-Host '[OK] Da cai dat QLBS Kiosk thanh cong.' -ForegroundColor Green
    exit 0
} catch {
    Fail $_.Exception.Message
}
