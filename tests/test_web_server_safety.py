import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from insta360_web_server import (
    CameraSession,
    file_record,
    file_records,
    media_mime,
    media_type,
    normalize_osc_file_path,
    parse_directory_listing,
)


class WebServerSafetyTests(unittest.TestCase):
    def test_media_classification(self):
        self.assertEqual(media_type("/DCIM/a.jpg"), "photo")
        self.assertEqual(media_type("/DCIM/a.insp"), "photo")
        self.assertEqual(media_type("/DCIM/a.mp4"), "video")
        self.assertEqual(media_mime("/DCIM/a.lrv"), "video/mp4")
        self.assertEqual(media_mime("/DCIM/a.insp"), "image/jpeg")

    def test_file_record_extracts_camera_timestamp(self):
        item = file_record("/storage_internal/DCIM/Camera01/IMG_20260802_174919_612.jpg")
        self.assertEqual(item["kind"], "photo")
        self.assertEqual(item["captured_at"], "2026-08-02T17:49:19")

    def test_proxy_path_must_come_from_current_file_list(self):
        session = CameraSession()
        session.files = ["/storage_internal/DCIM/Camera01/safe.jpg"]
        session.assert_known_path(session.files[0])
        with self.assertRaisesRegex(ValueError, "not in the current camera file list"):
            session.assert_known_path("/etc/passwd")

    def test_mp4_uses_matching_lrv_for_thumbnail(self):
        paths = [
            "/storage_internal/DCIM/Camera01/VID_20260802_120000_001.mp4",
            "/storage_internal/DCIM/Camera01/LRV_20260802_120000_001.lrv",
        ]
        records = file_records(paths)
        self.assertEqual(records[0]["proxy_path"], paths[1])
        self.assertIn("LRV_20260802", records[0]["thumbnail_url"])

    def test_insv_uses_matching_lrv_for_preview(self):
        paths = [
            "/storage_internal/DCIM/Camera01/VID_20260802_120000_001.insv",
            "/storage_internal/DCIM/Camera01/LRV_20260802_120000_001.lrv",
        ]
        records = file_records(paths)
        self.assertEqual(records[0]["proxy_path"], paths[1])

    def test_parses_unbounded_http_directory_listing(self):
        data = b'<a href="IMG_20260803_010203_001.jpg">photo</a><a href="../">up</a>'
        self.assertEqual(
            parse_directory_listing(data, "/storage_internal/DCIM/Camera01/"),
            ["/storage_internal/DCIM/Camera01/IMG_20260803_010203_001.jpg"],
        )

    def test_normalizes_camera_relative_directory_links(self):
        listing = b'<a href="/DCIM/Camera01/IMG_20260101_010203_00_001.jpg">photo</a>'
        self.assertEqual(
            parse_directory_listing(listing, "/storage_internal/DCIM/Camera01/"),
            ["/storage_internal/DCIM/Camera01/IMG_20260101_010203_00_001.jpg"],
        )

    def test_normalizes_osc_local_and_absolute_urls(self):
        expected = "/storage_internal/DCIM/Camera01/IMG_20260101_010203_00_001.jpg"
        self.assertEqual(
            normalize_osc_file_path({"_localFileUrl": "/DCIM/Camera01/IMG_20260101_010203_00_001.jpg"}),
            expected,
        )
        self.assertEqual(
            normalize_osc_file_path({"fileUrl": "http://192.168.42.1/DCIM/Camera01/IMG_20260101_010203_00_001.jpg"}),
            expected,
        )

    def test_rejects_osc_paths_outside_camera_media_directory(self):
        self.assertIsNone(normalize_osc_file_path({"_localFileUrl": "/etc/passwd"}))
        self.assertIsNone(normalize_osc_file_path({"_localFileUrl": "/DCIM/../etc/passwd.jpg"}))

    def test_osc_pagination_reads_past_500_entries(self):
        class FakeOscSession(CameraSession):
            def __init__(self):
                super().__init__()
                self.starts = []

            def _osc_json_request(self, method, path, payload=None):
                if method == "GET":
                    return {"api": ["/osc/commands/execute"]}
                start = payload["parameters"]["startPosition"]
                self.starts.append(start)
                end = min(start + 100, 650)
                return {
                    "state": "done",
                    "results": {
                        "entries": [
                            {"_localFileUrl": f"/DCIM/Camera01/IMG_{index:06d}.jpg"}
                            for index in range(start, end)
                        ],
                        "totalEntries": 650,
                    },
                }

        session = FakeOscSession()
        paths = session._discover_osc_files()
        self.assertEqual(len(paths), 650)
        self.assertEqual(session.starts, [0, 100, 200, 300, 400, 500, 600])

    def test_osc_pagination_advances_by_firmware_page_size(self):
        class CappedOscSession(CameraSession):
            def __init__(self):
                super().__init__()
                self.starts = []

            def _osc_json_request(self, method, path, payload=None):
                if method == "GET":
                    return {"api": ["/osc/commands/execute"]}
                start = payload["parameters"]["startPosition"]
                self.starts.append(start)
                end = min(start + 30, 65)
                return {
                    "state": "done",
                    "results": {
                        "entries": [
                            {"_localFileUrl": f"/DCIM/Camera01/VID_{index:06d}.mp4"}
                            for index in range(start, end)
                        ],
                        "totalEntries": 65,
                    },
                }

        session = CappedOscSession()
        self.assertEqual(len(session._discover_osc_files()), 65)
        self.assertEqual(session.starts, [0, 30, 60])

    def test_ucd2_pagination_stops_on_partial_verified_page(self):
        class FakeUcd2Session(CameraSession):
            def __init__(self):
                super().__init__()
                self.page = 0

            def _request(self, frame, timeout=10.0, parse_info=True):
                start = self.page * 100
                self.page += 1
                count = 50 if start == 500 else 100
                return b"\n".join(
                    f"/storage_internal/DCIM/Camera01/IMG_{index:06d}.jpg".encode()
                    for index in range(start, start + count)
                )

        session = FakeUcd2Session()
        paths, complete = session._discover_ucd2_files()
        self.assertTrue(complete)
        self.assertEqual(len(paths), 550)
        self.assertEqual(session.page, 6)


if __name__ == "__main__":
    unittest.main()
