import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.capture_ucd2_passive import describe_frame, extract_frames


class Ucd2ParserTests(unittest.TestCase):
    FRAME_1 = bytes.fromhex("55434432010c050100000000112834b2")
    FRAME_2 = bytes.fromhex("55434432010c050200000000f67b418a")

    def test_extracts_multiple_frames(self):
        frames, remaining, discarded = extract_frames(self.FRAME_1 + self.FRAME_2)
        self.assertEqual(frames, [self.FRAME_1, self.FRAME_2])
        self.assertEqual(remaining, b"")
        self.assertEqual(discarded, 0)

    def test_handles_noise_and_partial_magic(self):
        frames, remaining, discarded = extract_frames(b"noise" + self.FRAME_1 + b"UC")
        self.assertEqual(frames, [self.FRAME_1])
        self.assertEqual(remaining, b"UC")
        self.assertEqual(discarded, 5)

    def test_describes_observed_fields_without_guessing_tail(self):
        item = describe_frame(self.FRAME_1, 1000)
        self.assertEqual(item["frame_length"], 16)
        self.assertEqual(item["version"], 1)
        self.assertEqual(item["body_length"], 12)
        self.assertEqual(item["message_type"], 5)
        self.assertEqual(item["field_7"], 1)
        self.assertEqual(item["tail_hex"], "112834b2")


if __name__ == "__main__":
    unittest.main()
