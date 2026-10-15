import hashlib
import tempfile
import unittest
import zipfile
from pathlib import Path

from prepare_kiosk_release import REQUIRED_FILES, prepare

SHA = "1" * 40
REPO = "pvminh94/qlbv"
RUN_URL = f"https://github.com/{REPO}/actions/runs/123456"


class ReleasePreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "artifact"
        self.source.mkdir()
        self.destination = self.root / "release"
        self.files = {name: b"fixture" for name in REQUIRED_FILES}
        self.files["QLBS_Kiosk.exe"] = b"MZ" + bytes(128)
        self.files["BUILD_INFO.txt"] = (
            "\ufeffQLBS Kiosk 2.0.0\r\n"
            f"Source commit: {SHA}\r\n"
            "Build: Windows CI / .NET Framework / C# 5\r\n"
            "Authenticode: unsigned\r\n"
        ).encode("utf-8")

    def archive(self, extra_manifest="", duplicates=False):
        manifest = "\r\n".join(
            f"{hashlib.sha256(data).hexdigest()}  {name}"
            for name, data in self.files.items()
        ) + "\r\n" + extra_manifest
        path = self.source / "QLBS_Kiosk_2.0.0.zip"
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, data in self.files.items():
                archive.writestr(name, data)
            archive.writestr("SHA256SUMS.txt", manifest)
            if duplicates:
                with self.assertWarns(UserWarning):
                    archive.writestr("QLBS_Kiosk.exe", self.files["QLBS_Kiosk.exe"])
        return path

    def run_prepare(self, tag="kiosk-v2.0.0", sha=SHA, repository=REPO, run_url=RUN_URL):
        return prepare(self.source, self.destination, tag, sha, repository, run_url)

    def test_verified_windows_package_produces_four_assets(self):
        original = self.archive()
        result = self.run_prepare()
        self.assertEqual(result["commit"], SHA)
        self.assertEqual(len(result["assets"]), 4)
        self.assertEqual((self.destination / original.name).read_bytes(), original.read_bytes())
        self.assertEqual((self.destination / "QLBS_Kiosk.exe").read_bytes(), self.files["QLBS_Kiosk.exe"])
        for name in (original.name, "QLBS_Kiosk.exe"):
            expected = hashlib.sha256((self.destination / name).read_bytes()).hexdigest()
            self.assertEqual((self.destination / (name + ".sha256")).read_text(), f"{expected}  {name}\n")

    def test_untrusted_tag_is_rejected_before_output(self):
        self.archive()
        for tag in ("v2.0.0", "kiosk-v2.0.0;echo secret", "kiosk-v2.0.0\n", "../2.0.0"):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                self.run_prepare(tag=tag)
        self.assertFalse(self.destination.exists())

    def test_version_mismatch_is_rejected(self):
        self.archive()
        with self.assertRaisesRegex(ValueError, "matching the requested version"):
            self.run_prepare(tag="kiosk-v2.1.0")

    def test_source_commit_must_match_the_run(self):
        self.archive()
        with self.assertRaisesRegex(ValueError, "source commit"):
            self.run_prepare(sha="2" * 40)

    def test_mono_build_cannot_be_published_as_windows(self):
        self.files["BUILD_INFO.txt"] = self.files["BUILD_INFO.txt"].replace(b"Windows CI / .NET Framework / C# 5", b"Linux / Mono")
        self.archive()
        with self.assertRaisesRegex(ValueError, "actual Windows CI"):
            self.run_prepare()

    def test_missing_readme_is_rejected(self):
        del self.files["README.md"]
        self.archive()
        with self.assertRaisesRegex(ValueError, "missing"):
            self.run_prepare()

    def test_third_bat_is_rejected(self):
        self.files["legacy_workaround.bat"] = b"fixture"
        self.archive()
        with self.assertRaisesRegex(ValueError, "exactly the two"):
            self.run_prepare()

    def test_unsafe_archive_path_is_rejected(self):
        for name in ("../outside.txt", "/absolute.txt", "C:\\outside.txt", "nested\\outside.txt"):
            with self.subTest(name=name):
                self.files[name] = b"unsafe"
                self.archive()
                with self.assertRaisesRegex(ValueError, "Unsafe ZIP"):
                    self.run_prepare()
                del self.files[name]

    def test_duplicate_zip_entry_is_rejected(self):
        self.archive(duplicates=True)
        with self.assertRaisesRegex(ValueError, "Duplicate ZIP"):
            self.run_prepare()

    def test_duplicate_manifest_entry_is_rejected(self):
        self.archive(extra_manifest=f"{'0' * 64}  README.md\r\n")
        with self.assertRaisesRegex(ValueError, "duplicate checksum"):
            self.run_prepare()

    def test_corrupt_payload_is_rejected(self):
        self.archive()
        path = self.source / "QLBS_Kiosk_2.0.0.zip"
        with zipfile.ZipFile(path) as archive:
            content = {info.filename: archive.read(info.filename) for info in archive.infolist()}
        content["QLBS_Kiosk.exe"] = b"MZtampered"
        with zipfile.ZipFile(path, "w") as archive:
            for name, data in content.items():
                archive.writestr(name, data)
        with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
            self.run_prepare()

    def test_existing_assets_are_not_overwritten(self):
        self.archive()
        self.destination.mkdir()
        sentinel = self.destination / "published.exe"
        sentinel.write_bytes(b"keep")
        with self.assertRaisesRegex(ValueError, "must be empty"):
            self.run_prepare()
        self.assertEqual(sentinel.read_bytes(), b"keep")

    def test_other_repository_ci_url_is_rejected(self):
        self.archive()
        with self.assertRaisesRegex(ValueError, "CI evidence URL"):
            self.run_prepare(run_url="https://github.com/another/repo/actions/runs/123456")

    def test_fake_pe_is_rejected(self):
        self.files["QLBS_Kiosk.exe"] = b"not a PE"
        self.archive()
        with self.assertRaisesRegex(ValueError, "Windows PE"):
            self.run_prepare()

    def test_multiple_candidate_zips_are_rejected(self):
        original = self.archive()
        (self.source / "QLBS_Kiosk_1.0.0.zip").write_bytes(original.read_bytes())
        with self.assertRaisesRegex(ValueError, "Exactly one"):
            self.run_prepare()


if __name__ == "__main__":
    unittest.main()
