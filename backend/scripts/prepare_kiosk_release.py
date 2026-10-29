"""Verify a Windows CI artifact and prepare immutable public release assets.

Uses the Python standard library only. No credentials, network requests or git writes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import zipfile
from pathlib import Path, PurePosixPath

REQUIRED_FILES = {
    "QLBS_Kiosk.exe", "QLBS_Kiosk.cs", "cai_dat_kiosk.bat", "cai_dat_kiosk.ps1", "tao_goi_cai_dat_kiosk.ps1", "go_bo_kiosk.bat",
    "README.md", "HUONG_DAN_SU_DUNG.md", "GOI_CAI_DAT_NOI_BO.md", "KIEM_THU_V2.md", "BUILD_INFO.txt", "NOTICE.md",
}
MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024


def prepare(source: Path, destination: Path, tag: str, sha: str, repository: str, run_url: str) -> dict:
    match = re.fullmatch(r"kiosk-v(\d+\.\d+\.\d+)", tag)
    if not match:
        raise ValueError("Release tag must have the form kiosk-v2.0.0")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Expected a full lowercase source commit SHA")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Invalid repository name")
    if not re.fullmatch(rf"https://github\.com/{re.escape(repository)}/actions/runs/\d+", run_url):
        raise ValueError("CI evidence URL must belong to this repository")

    version = match.group(1)
    candidates = sorted(source.glob("QLBS_Kiosk_*.zip"))
    if len(candidates) != 1 or candidates[0].name != f"QLBS_Kiosk_{version}.zip":
        raise ValueError("Exactly one package ZIP matching the requested version is required")
    package = candidates[0]
    with zipfile.ZipFile(package) as archive:
        members = archive.infolist()
        names = [member.filename for member in members]
        if len(names) != len(set(names)):
            raise ValueError("Duplicate ZIP entries are not allowed")
        if sum(member.file_size for member in members) > MAX_UNCOMPRESSED_BYTES:
            raise ValueError("Unexpectedly large package")
        for name in names:
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name:
                raise ValueError("Unsafe ZIP entry")
        files = {member.filename for member in members if not member.is_dir()}
        if not REQUIRED_FILES <= files or "SHA256SUMS.txt" not in files:
            raise ValueError("Package is missing its executable, source, two BATs or documentation")
        if {name for name in files if name.lower().endswith(".bat")} != {"cai_dat_kiosk.bat", "go_bo_kiosk.bat"}:
            raise ValueError("Package must contain exactly the two supported BAT files")
        if archive.testzip() is not None:
            raise ValueError("Package CRC verification failed")

        checksums = {}
        for line in archive.read("SHA256SUMS.txt").decode("ascii").splitlines():
            entry = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
            if not entry or entry.group(2) in checksums:
                raise ValueError("Invalid or duplicate checksum entry")
            checksums[entry.group(2)] = entry.group(1)
        if set(checksums) != files - {"SHA256SUMS.txt"}:
            raise ValueError("Checksum manifest must cover every package file")
        for name, expected in checksums.items():
            if hashlib.sha256(archive.read(name)).hexdigest() != expected:
                raise ValueError(f"Checksum mismatch: {name}")

        info = archive.read("BUILD_INFO.txt").decode("utf-8-sig")
        if info.splitlines()[0].strip() != f"QLBS Kiosk {version}":
            raise ValueError("Build version does not match release tag")
        if not re.search(rf"(?m)^Source commit: {sha}\s*$", info):
            raise ValueError("Artifact was not built from this workflow's source commit")
        if "Build: Windows CI / .NET Framework / C# 5" not in info:
            raise ValueError("Only the actual Windows CI build can be published")
        executable = archive.read("QLBS_Kiosk.exe")
        if not executable.startswith(b"MZ"):
            raise ValueError("Executable is not a Windows PE image")

    if destination.exists() and any(destination.iterdir()):
        raise ValueError("Release destination must be empty; do not replace existing assets")
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(package, destination / package.name)
    (destination / "QLBS_Kiosk.exe").write_bytes(executable)
    assets = []
    for name in (package.name, "QLBS_Kiosk.exe"):
        digest = hashlib.sha256((destination / name).read_bytes()).hexdigest()
        checksum_name = name + ".sha256"
        (destination / checksum_name).write_text(f"{digest}  {name}\n", encoding="ascii")
        assets.extend([name, checksum_name])

    notes = f"""# QLBS Kiosk {version} — Windows WinForms native

**Tải `QLBS_Kiosk_{version}.zip` ở mục Assets bên dưới, không chọn Source code (zip).**

- Một `QLBS_Kiosk.exe`; không cần Edge/WebView/Agent phụ, không cần webcam PC.
- ZIP có EXE Windows, source C# 5, đúng hai BAT cài/gỡ, script PowerShell tạo gói một lần cho certificate tự ký, hướng dẫn mới và SHA-256.
- [Cài nhanh](https://github.com/{repository}/blob/main/deploy/windows/README.md) · [Hướng dẫn từng bước](https://github.com/{repository}/blob/main/deploy/windows/HUONG_DAN_SU_DUNG.md) · [Gói nội bộ một lần](https://github.com/{repository}/blob/main/deploy/windows/GOI_CAI_DAT_NOI_BO.md).
- Cập nhật VPS 1 bằng `sudo bash deploy/update.sh` trước khi cài máy trạm; đặt PIN IT riêng, dùng đúng URL web gốc và mã phòng.
- PC và điện thoại phải truy cập cùng web QLBV; HTTPS tin cậy cần cho camera tự mở. Dùng camera điện thoại quét QR, không dùng webcam PC.
- Thành công thì ẩn toàn bộ kiosk, trả Desktop, không tự mở HIS; hết ca + grace tự khoá lại.

## Kiểm chứng bản build

- Source commit: `{sha}`.
- [CI của chính bản phát hành này]({run_url}): backend/frontend gates, compiler .NET Framework Windows, native self-tests, 40 phiên bản QR, WinForms rendering, PowerShell/BAT checks.
- Đối chiếu ZIP/EXE với các file `.sha256` đi kèm. `BUILD_INFO.txt` trong ZIP ghi nguồn build.
- EXE **chưa ký Authenticode**. Không tắt Defender/SmartScreen toàn hệ thống.

CI không thay thế nghiệm thu UAC/ACL/hook/Desktop, DPI/nhiều màn hình, mạng, điện thoại và AI/PAD thật tại viện. `WH_KEYBOARD_LL` là user-mode, không chặn được `Ctrl+Alt+Del`.
"""
    (destination / "release-notes.md").write_text(notes, encoding="utf-8")
    result = {"tag": tag, "version": version, "commit": sha, "assets": assets}
    (destination / "release-info.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--run-url", required=True)
    arguments = parser.parse_args()
    result = prepare(arguments.source, arguments.destination, arguments.tag, arguments.sha, arguments.repository, arguments.run_url)
    print(json.dumps(result, indent=2))
