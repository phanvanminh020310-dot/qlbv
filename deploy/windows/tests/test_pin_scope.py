"""Native kiosk policy guards: all Windows accounts, active-shift-only lock, online release.

This source-only suite needs no hospital configuration, Windows credentials or network.
"""
import hashlib
import re
import unittest
from pathlib import Path

WINDOWS_DIR = Path(__file__).resolve().parents[1]
SOURCE = WINDOWS_DIR / "QLBS_Kiosk.cs"


def class_block(text, name):
    start = re.search(r"(?m)^    internal (?:sealed |static )?class " + re.escape(name) + r"\b", text)
    if not start:
        raise AssertionError("Missing class: " + name)
    following = re.search(r"(?m)^    internal (?:sealed |static )?class \w+", text[start.end():])
    if not following:
        raise AssertionError("Missing class boundary: " + name)
    return text[start.start():start.end() + following.start()]


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class NativeKioskPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SOURCE.read_text(encoding="utf-8-sig")

    def test_version_and_all_account_runtime_policy_are_explicit(self):
        self.assertIn('[assembly: AssemblyVersion("2.0.6.0")]', self.source)
        self.assertIn('internal const string Version = "2.0.6";', self.source)
        program = class_block(self.source, "Program")
        self.assertIn("including local/domain Administrators and UAC-filtered tokens", program)
        self.assertIn("no account-based runtime bypass", program)
        self.assertNotIn("AccountPolicy", self.source)
        self.assertNotIn("GetTokenInformation", self.source)
        self.assertNotIn("Environment.UserName", self.source)

    def test_native_lock_requires_explicit_online_active_shift_snapshot(self):
        snapshot = class_block(self.source, "KioskSnapshot")
        view = class_block(self.source, "KioskView")
        context = class_block(self.source, "KioskContext")
        self.assertIn('result.KioskRequired = Json.Flag(data, "kioskRequired");', snapshot)
        self.assertIn("if (!result.KioskRequired) { result.IsUnlocked = true; return result; }", snapshot)
        self.assertIn("if (!snapshot.KioskRequired)", view)
        self.assertIn("MarkReleased(\"Không có ca trực đang diễn ra. Desktop đang được mở.\"", view)
        self.assertIn("internal bool Locked, Connected, Scanned;", view)
        self.assertIn("Release(\"Không kết nối được máy chủ; Desktop đang được mở.", context)
        self.assertIn("Release(\"Đang đối soát lại ca trực sau khi máy tính hoạt động trở lại…\"", context)
        self.assertNotIn("Lock(\"Đang cập nhật lịch trực", context)
        self.assertIn("Status response alone may apply a lock after exact online reconciliation", context)

    def test_server_pin_and_keyboard_guard_remain_online_and_scoped(self):
        it_body = class_block(self.source, "ItDialog").split("        private void Verify(", 1)[1]
        self.assertEqual(digest(it_body), "ba3fa8d13ebdb10d2d08e226ace8e225ec97675f11f668aec439ebf350cc61d2")
        hook = class_block(self.source, "KeyboardGuard").split("        private IntPtr Handle(", 1)[1]
        self.assertEqual(digest(hook), "167b6a2905b865bd0b66451040b3670c36e4d08372eb87584870015eafa7a49c")
        self.assertNotIn("default", it_body.lower())

    def test_qr_subtitle_removed_and_self_test_covers_release(self):
        self.assertNotIn("Không cần camera máy tính", self.source)
        self.assertNotIn("Không yêu cầu GPS", self.source)
        selftest = class_block(self.source, "SelfTests")
        self.assertIn('"kioskRequired\\":true', selftest)
        self.assertIn("no active shift releases desktop", selftest)
        self.assertIn("offline releases desktop", selftest)

    def test_site_bundle_installer_pins_a_reviewed_public_certificate(self):
        bat = (WINDOWS_DIR / "cai_dat_kiosk.bat").read_text(encoding="utf-8-sig")
        installer = (WINDOWS_DIR / "cai_dat_kiosk.ps1").read_text(encoding="utf-8-sig")
        generator = (WINDOWS_DIR / "tao_goi_cai_dat_kiosk.ps1").read_text(encoding="utf-8-sig")
        self.assertIn('QLBS_Kiosk_Install.ini', bat)
        self.assertIn('QLBS_Server_Trust.cer', bat)
        self.assertIn('TrustLocalCertificate', installer)
        self.assertIn('certificate_sha256', installer)
        self.assertIn("X509Store('Root', 'LocalMachine')", installer)
        self.assertIn("TrustFailure", self.source)
        self.assertIn("SecureChannelFailure", self.source)
        self.assertIn('never downloads or accepts a certificate from the network', installer)
        self.assertNotIn('WebRequest', installer)
        self.assertNotIn('Invoke-WebRequest', installer)
        self.assertIn('QLBS_Server_Trust.cer', generator)
        self.assertIn('does not contain a private key', generator)
        self.assertIn('certificateData.HasPrivateKey', generator)


if __name__ == "__main__":
    unittest.main()
