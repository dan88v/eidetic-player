from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock


MODULE_PATH = Path(__file__).with_name("lib") / "gpio_i2s_dac.py"
SPEC = importlib.util.spec_from_file_location("eidetic_gpio_i2s_dac", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
dac = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dac)


class Fixture:
    def __init__(self, temporary: str) -> None:
        self.root = Path(temporary)

    def config(
        self,
        content: bytes = b"dtparam=audio=on\n",
        *,
        layout: str = "firmware",
        overlay: bool = True,
    ) -> Path:
        base = self.root / "boot" / layout
        if layout == "firmware":
            path = base / "config.txt"
        else:
            base = self.root / "boot"
            path = base / "config.txt"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        os.chmod(path, 0o640)
        if overlay:
            overlay_dir = path.parent / "overlays"
            overlay_dir.mkdir(parents=True, exist_ok=True)
            (overlay_dir / "i2s-dac.dtbo").write_bytes(b"fixture")
        return path

    def apply(self, session: str = "fixture") -> str:
        return dac.apply(self.root, True, session)


class GpioI2sDacTests(unittest.TestCase):
    def fixture(self) -> tuple[tempfile.TemporaryDirectory[str], Fixture]:
        temporary = tempfile.TemporaryDirectory()
        return temporary, Fixture(temporary.name)

    def test_boot_layout_selection_and_safety(self) -> None:
        temporary, fixture = self.fixture()
        with temporary:
            firmware = fixture.config()
            legacy = fixture.config(layout="legacy")
            result = dac.inspect(fixture.root, True)
            self.assertEqual(result.config, firmware)
            self.assertEqual(result.logical, "/boot/firmware/config.txt")
            firmware.unlink()
            result = dac.inspect(fixture.root, True)
            self.assertEqual(result.config, legacy)
            self.assertEqual(result.logical, "/boot/config.txt")

        temporary, fixture = self.fixture()
        with temporary:
            self.assertEqual(
                dac.inspect(fixture.root, True).state, "unsupported-platform"
            )
            config = fixture.config(b"")
            self.assertEqual(dac.inspect(fixture.root, True).state, "failed")
            config.unlink()
            real = fixture.root / "real-config"
            real.write_bytes(b"dtparam=audio=on\n")
            try:
                config.symlink_to(real)
            except OSError:
                pass
            else:
                self.assertEqual(dac.inspect(fixture.root, True).state, "failed")

        temporary, fixture = self.fixture()
        with temporary:
            fixture.config(overlay=False)
            self.assertEqual(
                dac.inspect(fixture.root, True).state, "overlay-unavailable"
            )
            self.assertEqual(
                dac.inspect(fixture.root, False).state, "unsupported-platform"
            )

    def test_newline_sections_and_unmanaged_bytes_are_preserved(self) -> None:
        cases = (
            b"dtparam=audio=on\n",
            b"dtparam=audio=on\r\n",
            b"dtparam=audio=on",
            b"[all]\ndtparam=audio=on\n",
            b"[pi4]\nfoo=bar\n[all]\ndtparam=audio=on\n[pi3]\nbaz=1\n",
            b"# dtoverlay=i2s-dac\n; dtoverlay=i2s-dac\n[all]\n",
        )
        for index, original in enumerate(cases):
            with self.subTest(index=index):
                candidate, offset, inserted = dac.insertion_candidate(original)
                dac.validate_added(original, candidate, offset, inserted)
                self.assertEqual(
                    candidate[:offset] + candidate[offset + len(inserted) :],
                    original,
                )
                expected_newline = b"\r\n" if b"\r\n" in original else b"\n"
                self.assertIn(
                    expected_newline.join(
                        (dac.BEGIN.encode(), dac.OVERLAY.encode(), dac.END.encode())
                    ),
                    candidate,
                )

    def test_preexisting_managed_and_malformed_ownership(self) -> None:
        for line in (
            b"dtoverlay=i2s-dac\n",
            b" dtoverlay=i2s-dac\n",
            b"dtoverlay = i2s-dac   \n",
        ):
            temporary, fixture = self.fixture()
            with temporary:
                config = fixture.config(b"dtparam=audio=on\n" + line)
                original = config.read_bytes()
                self.assertEqual(fixture.apply(), "preexisting")
                self.assertEqual(config.read_bytes(), original)
                self.assertFalse((dac.backups_path(fixture.root) / dac.BACKUP_KEY).exists())
                self.assertEqual(
                    dac.read_manifest(fixture.root)[1].status, "preexisting"
                )

        temporary, fixture = self.fixture()
        with temporary:
            fixture.config(
                (
                    f"{dac.BEGIN}\n{dac.OVERLAY}\n{dac.END}\n"
                ).encode()
            )
            self.assertEqual(
                dac.inspect(fixture.root, True).state, "managed-unowned"
            )
            self.assertEqual(fixture.apply(), "managed-unowned")

        malformed = (
            f"{dac.BEGIN}\n{dac.OVERLAY}\n",
            f"{dac.END}\n{dac.OVERLAY}\n{dac.BEGIN}\n",
            f"{dac.BEGIN}\n{dac.OVERLAY}\n{dac.END}\n"
            f"{dac.BEGIN}\n{dac.OVERLAY}\n{dac.END}\n",
            "dtoverlay=i2s-dac\ndtoverlay=i2s-dac\n",
        )
        for content in malformed:
            temporary, fixture = self.fixture()
            with temporary:
                fixture.config(content.encode())
                self.assertEqual(dac.inspect(fixture.root, True).state, "conflict")

    def test_conflicts_are_conservative_without_false_video_hits(self) -> None:
        conflicts = (
            "hifiberry-dacplus",
            "iqaudio-dacplus",
            "allo-boss-dac-pcm512x-audio",
            "justboom-dac",
            "audioinjector-wm8731-audio",
            "dacberry400",
            "simple-audio-card",
            "rpi-dac",
            "vendor-i2s-codec",
            "mystery-audio",
        )
        for overlay in conflicts:
            temporary, fixture = self.fixture()
            with temporary:
                fixture.config(f"dtoverlay={overlay}\n".encode())
                self.assertEqual(dac.inspect(fixture.root, True).state, "conflict")
        for overlay in ("vc4-kms-v3d", "vc4-fkms-v3d", "gpio-fan"):
            temporary, fixture = self.fixture()
            with temporary:
                fixture.config(
                    f"dtparam=audio=on\ndtoverlay={overlay}\n".encode()
                )
                self.assertEqual(dac.inspect(fixture.root, True).state, "absent")

    def test_apply_is_atomic_idempotent_and_rolls_back_its_session(self) -> None:
        temporary, fixture = self.fixture()
        with temporary:
            original = b"# fixture\n[all]\ndtparam=audio=on\n"
            config = fixture.config(original)
            before = config.stat()
            self.assertEqual(fixture.apply("one"), "added")
            managed = config.read_bytes()
            self.assertEqual(managed.count(dac.BEGIN.encode()), 1)
            self.assertEqual(managed.count(dac.OVERLAY.encode()), 1)
            if os.name != "nt":
                self.assertEqual(stat.S_IMODE(config.stat().st_mode), 0o640)
                self.assertEqual(config.stat().st_uid, before.st_uid)
                self.assertEqual(config.stat().st_gid, before.st_gid)
            backup = dac.backups_path(fixture.root) / dac.BACKUP_KEY
            self.assertEqual(backup.read_bytes(), original)
            self.assertEqual(
                dac.inspect(fixture.root, True).state,
                "managed",
            )
            backup_count = len(list(dac.backups_path(fixture.root).iterdir()))
            self.assertEqual(fixture.apply("two"), "managed")
            self.assertEqual(config.read_bytes(), managed)
            self.assertEqual(
                len(list(dac.backups_path(fixture.root).iterdir())), backup_count
            )
            self.assertEqual(dac.rollback(fixture.root, "one"), "rolled-back")
            self.assertEqual(config.read_bytes(), original)
            self.assertIsNone(dac.read_manifest(fixture.root)[1])
            self.assertFalse(backup.exists())
            self.assertFalse(any(config.parent.glob(".config.txt.eidetic-*")))

    def test_rollback_refuses_external_changes(self) -> None:
        temporary, fixture = self.fixture()
        with temporary:
            config = fixture.config()
            fixture.apply("external")
            config.write_bytes(config.read_bytes() + b"# external\n")
            with self.assertRaisesRegex(dac.DacError, "external config change"):
                dac.rollback(fixture.root, "external")
            self.assertIn(b"# external\n", config.read_bytes())

    def test_failure_before_config_rename_leaves_original_and_no_ownership(self) -> None:
        temporary, fixture = self.fixture()
        with temporary:
            config = fixture.config()
            original = config.read_bytes()
            real_atomic_write = dac.atomic_write
            failed = False

            def fail_once(path: Path, data: bytes, **options: object) -> None:
                nonlocal failed
                if path == config and not failed:
                    failed = True
                    raise OSError("fixture before rename")
                real_atomic_write(path, data, **options)

            with mock.patch.object(dac, "atomic_write", side_effect=fail_once):
                with self.assertRaisesRegex(OSError, "before rename"):
                    fixture.apply("before-rename")
            self.assertEqual(config.read_bytes(), original)
            self.assertIsNone(dac.read_manifest(fixture.root)[1])
            self.assertFalse((dac.backups_path(fixture.root) / dac.BACKUP_KEY).exists())

    def test_failure_after_backup_temp_does_not_touch_config(self) -> None:
        temporary, fixture = self.fixture()
        with temporary:
            config = fixture.config()
            original = config.read_bytes()
            real_replace = dac.os.replace

            def fail_backup(source: object, destination: object) -> None:
                if Path(destination).name == dac.BACKUP_KEY:
                    raise OSError("fixture backup rename")
                real_replace(source, destination)

            with mock.patch.object(dac.os, "replace", side_effect=fail_backup):
                with self.assertRaisesRegex(OSError, "backup rename"):
                    fixture.apply("backup-rename")
            self.assertEqual(config.read_bytes(), original)
            self.assertFalse(any(config.parent.glob(".config.txt.eidetic-*")))
            self.assertFalse(
                any(dac.backups_path(fixture.root).glob(".gpio-i2s-dac-*"))
            )

    def test_failure_after_config_rename_restores_original(self) -> None:
        temporary, fixture = self.fixture()
        with temporary:
            config = fixture.config(b"[all]\ndtparam=audio=on\n")
            original = config.read_bytes()
            real_validate = dac.validate_added
            calls = 0

            def fail_post_write(
                before: bytes, candidate: bytes, offset: int, inserted: bytes
            ) -> tuple[int, int]:
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise dac.DacError("fixture post-write validation")
                return real_validate(before, candidate, offset, inserted)

            with mock.patch.object(dac, "validate_added", side_effect=fail_post_write):
                with self.assertRaisesRegex(dac.DacError, "post-write validation"):
                    fixture.apply("post-write")
            self.assertEqual(config.read_bytes(), original)
            self.assertIsNone(dac.read_manifest(fixture.root)[1])
            self.assertFalse((dac.backups_path(fixture.root) / dac.BACKUP_KEY).exists())

    def test_remove_is_explicit_managed_only_and_preserves_external_content(self) -> None:
        temporary, fixture = self.fixture()
        with temporary:
            config = fixture.config(b"[all]\ndtparam=audio=on\n")
            self.assertEqual(fixture.apply("remove"), "added")
            dac.commit(fixture.root, "remove")
            config.write_bytes(config.read_bytes() + b"# external hardware\n")
            self.assertEqual(dac.remove(fixture.root, True), "removed")
            result = config.read_bytes()
            self.assertNotIn(dac.BEGIN.encode(), result)
            self.assertIn(b"dtparam=audio=on", result)
            self.assertIn(b"# external hardware\n", result)
            self.assertTrue(
                any(
                    dac.backups_path(fixture.root).glob(
                        "gpio-i2s-dac-pre-removal-*"
                    )
                )
            )
            self.assertEqual(fixture.apply("readd"), "added")
            dac.rollback(fixture.root, "readd")

        temporary, fixture = self.fixture()
        with temporary:
            config = fixture.config(b"dtoverlay=i2s-dac\n")
            original = config.read_bytes()
            fixture.apply()
            self.assertEqual(
                dac.remove(fixture.root, True), "preserved-preexisting"
            )
            self.assertEqual(config.read_bytes(), original)

    def test_remove_failure_restores_managed_block_and_ownership(self) -> None:
        temporary, fixture = self.fixture()
        with temporary:
            config = fixture.config()
            fixture.apply("remove-failure")
            dac.commit(fixture.root, "remove-failure")
            managed = config.read_bytes()
            real_write_record = dac.write_feature_record

            def fail_removal_record(
                root: Path, record: object | None
            ) -> None:
                if record is None:
                    raise OSError("fixture removal manifest")
                real_write_record(root, record)

            with mock.patch.object(
                dac, "write_feature_record", side_effect=fail_removal_record
            ):
                with self.assertRaisesRegex(OSError, "removal manifest"):
                    dac.remove(fixture.root, True)
            self.assertEqual(config.read_bytes(), managed)
            self.assertEqual(dac.inspect(fixture.root, True).state, "managed")

    def test_unknown_manifest_block_version_never_proves_ownership(self) -> None:
        temporary, fixture = self.fixture()
        with temporary:
            fixture.config()
            fixture.apply("manifest-version")
            dac.commit(fixture.root, "manifest-version")
            manifest = dac.manifest_path(fixture.root)
            manifest.write_text(
                manifest.read_text(encoding="utf-8").replace(
                    f"\t{dac.BLOCK_VERSION}\n", "\t999\n"
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(dac.DacError, "ownership record"):
                dac.inspect(fixture.root, True)


if __name__ == "__main__":
    unittest.main()
