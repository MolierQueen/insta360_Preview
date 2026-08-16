import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.probe_camera_readonly import ReadOnlyCamera


class ReadOnlySafetyTests(unittest.TestCase):
    def setUp(self):
        self.camera = ReadOnlyCamera(callback=lambda response: None)

    def tearDown(self):
        self.camera.program_killed = True
        self.camera.Close()

    def test_only_read_commands_are_allowed(self):
        self.assertEqual(self.camera.ALLOWED_COMMANDS, {8, 13})

    def test_time_synchronization_is_disabled(self):
        self.assertIsNone(self.camera.SyncLocalTimeToCamera())
        self.assertEqual(self.camera.sent_messages_codes, {})

    def test_write_command_is_rejected_before_socket_use(self):
        with self.assertRaisesRegex(RuntimeError, "rejected camera command 12"):
            self.camera.SendMessage({}, 12)
        self.assertEqual(self.camera.sent_messages_codes, {})


if __name__ == "__main__":
    unittest.main()
