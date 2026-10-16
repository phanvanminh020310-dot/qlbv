"""Guard approved native policy: standard Users lock; Administrators bypass by group SID.

This source-only suite needs no hospital configuration, Windows credentials or network.
"""
import hashlib
import re
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "QLBS_Kiosk.cs"


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


class NativeAccountPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SOURCE.read_text(encoding="utf-8-sig")

    def test_version_and_policy_are_explicit(self):
        self.assertIn('[assembly: AssemblyVersion("2.0.3.0")]', self.source)
        self.assertIn('internal const string Version = "2.0.3";', self.source)
        policy = class_block(self.source, "AccountPolicy")
        self.assertIn('AdministratorsSid = "S-1-5-32-544"', policy)
        self.assertIn("GetTokenInformation", policy)
        self.assertIn("WindowsBuiltInRole.Administrator", policy)
        self.assertNotIn("Environment.UserName", policy)

    def test_program_bypasses_admin_before_kiosk_components_start(self):
        program = class_block(self.source, "Program")
        guard = "if (!explicitSetup && AccountPolicy.IsAdministratorAccount()) return 0;"
        self.assertIn(guard, program)
        self.assertLess(program.index(guard), program.index("new Mutex"))
        self.assertLess(program.index(guard), program.index("new KioskContext"))
        self.assertLess(program.index(guard), program.index("KioskConfig.Load"))

    def test_deny_only_administrators_are_not_mistaken_for_standard_users(self):
        policy = class_block(self.source, "AccountPolicy")
        self.assertIn("Attributes are intentionally ignored", policy)
        self.assertIn("HasAdministratorInTokenGroups", policy)
        self.assertIn("TestRawAdminTokenGroups", class_block(self.source, "SelfTests"))
        self.assertNotIn("Environment.UserName", self.source)

    def test_server_pin_hook_and_network_lease_logic_remain_unchanged(self):
        it_body = class_block(self.source, "ItDialog").split("        private void Verify(", 1)[1]
        self.assertEqual(digest(it_body), "ba3fa8d13ebdb10d2d08e226ace8e225ec97675f11f668aec439ebf350cc61d2")
        hook = class_block(self.source, "KeyboardGuard").split("        private IntPtr Handle(", 1)[1]
        self.assertEqual(digest(hook), "167b6a2905b865bd0b66451040b3670c36e4d08372eb87584870015eafa7a49c")
        network = class_block(self.source, "KioskContext").split("        private void Apply(", 1)[1].split("        private void ShowItDialog()", 1)[0]
        self.assertEqual(digest(network), "6b1eec99b610e357683ea5ae1d345bc6d35785a12b2f1e673f8e981e4b96d0e3")


if __name__ == "__main__":
    unittest.main()
