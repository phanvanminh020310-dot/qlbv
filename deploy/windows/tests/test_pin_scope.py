"""Guard the user's accepted 2.0.0 baseline: PIN focus fix, all accounts still lock.

Hashes come from the immutable accepted 2.0.0 native source. No network, git
history, credentials or hospital-specific configuration is needed to run this.
"""
import hashlib
import re
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / 'QLBS_Kiosk.cs'
PIN_CLASSES = ('KioskContext', 'KeyboardGuard', 'ItDialog')


def class_block(text, name):
    start = re.search(r'(?m)^    internal (?:sealed |static )?class ' + re.escape(name) + r'\b', text)
    if not start:
        raise AssertionError('Missing class: ' + name)
    following = re.search(r'(?m)^    internal (?:sealed |static )?class \w+', text[start.end():])
    if not following:
        raise AssertionError('Missing class boundary: ' + name)
    return text[start.start():start.end() + following.start()]


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


class AcceptedBaselinePinPatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SOURCE.read_text(encoding='utf-8-sig')

    def test_non_pin_code_is_identical_to_accepted_baseline_except_version(self):
        masked = self.source.replace('"2.0.2.0"', '"2.0.0.0"').replace(
            'internal const string Version = "2.0.2"', 'internal const string Version = "2.0.0"')
        for name in PIN_CLASSES:
            masked = masked.replace(class_block(masked, name), '<PIN-CLASS ' + name + '>\n', 1)
        self.assertEqual(digest(masked), '29f570257833474f40b545beab53d3f262bbbca2e895248d4d3f1547dc75b152')

    def test_no_administrator_or_username_runtime_exemption(self):
        self.assertNotIn('AccountPolicy', self.source)
        for name in ('Program', 'KioskContext', 'KeyboardGuard'):
            runtime = class_block(self.source, name)
            for exemption in ('IsAdministratorAccount', 'WindowsIdentity', 'WindowsPrincipal', 'IsInRole', 'Environment.UserName'):
                self.assertNotIn(exemption, runtime, name + ' must apply to all accounts')
        self.assertIn('new KioskContext(config)', class_block(self.source, 'Program'))

    def test_server_pin_verification_and_unlock_logic_unchanged(self):
        body = class_block(self.source, 'ItDialog').split('        private void Verify(', 1)[1]
        self.assertEqual(digest(body), 'ba3fa8d13ebdb10d2d08e226ace8e225ec97675f11f668aec439ebf350cc61d2')

    def test_keyboard_hook_and_escape_blocking_body_unchanged(self):
        body = class_block(self.source, 'KeyboardGuard').split('        private IntPtr Handle(', 1)[1]
        self.assertEqual(digest(body), '167b6a2905b865bd0b66451040b3670c36e4d08372eb87584870015eafa7a49c')
        self.assertIn('Native.SetWindowsHookEx(13, callback', self.source)

    def test_network_lease_and_desktop_release_logic_unchanged(self):
        body = class_block(self.source, 'KioskContext').split('        private void Apply(', 1)[1].split('        private void ShowItDialog()', 1)[0]
        self.assertEqual(digest(body), '6b1eec99b610e357683ea5ae1d345bc6d35785a12b2f1e673f8e981e4b96d0e3')

    def test_versioned_without_replacing_published_2_0_0_or_2_0_1(self):
        self.assertIn('[assembly: AssemblyVersion("2.0.2.0")]', self.source)
        self.assertIn('internal const string Version = "2.0.2";', self.source)


if __name__ == '__main__':
    unittest.main()
