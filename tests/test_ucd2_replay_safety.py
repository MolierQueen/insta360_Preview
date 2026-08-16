import socket
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.probe_ucd2_replay_readonly import (
    GET_FILE_LIST_FRAME,
    GET_FILE_LIST_FRAMES,
    GET_OPTIONS_FRAME,
    candidate_http_paths,
    extract_frames,
    inner_request_code,
    send_readonly,
)


class FakeSocket:
    def __init__(self):
        self.sent = []

    def sendall(self, data):
        self.sent.append(data)


class Ucd2ReplaySafetyTests(unittest.TestCase):
    def test_captured_frames_are_only_read_commands(self):
        self.assertEqual(inner_request_code(GET_OPTIONS_FRAME), 8)
        self.assertTrue(GET_FILE_LIST_FRAMES)
        self.assertTrue(
            all(inner_request_code(frame) == 13 for frame in GET_FILE_LIST_FRAMES)
        )

    def test_rejects_modified_write_command_before_send(self):
        frame = bytearray(GET_OPTIONS_FRAME)
        frame[12:14] = (7).to_bytes(2, "little")
        sock = FakeSocket()
        with self.assertRaisesRegex(RuntimeError, "rejected command 7"):
            send_readonly(sock, bytes(frame))
        self.assertEqual(sock.sent, [])

    def test_dynamic_payload_length_parsing(self):
        frames, remaining, discarded = extract_frames(
            GET_OPTIONS_FRAME + GET_FILE_LIST_FRAME
        )
        self.assertEqual(frames, [GET_OPTIONS_FRAME, GET_FILE_LIST_FRAME])
        self.assertEqual(remaining, b"")
        self.assertEqual(discarded, 0)

    def test_http_candidates_preserve_only_expected_path_variants(self):
        paths = candidate_http_paths(
            "/storage_internal/DCIM/Camera01/example file.mp4"
        )
        self.assertEqual(
            paths,
            [
                "/DCIM/Camera01/example%20file.mp4",
                "/storage_internal/DCIM/Camera01/example%20file.mp4",
                "/files/DCIM/Camera01/example%20file.mp4",
            ],
        )


if __name__ == "__main__":
    unittest.main()
