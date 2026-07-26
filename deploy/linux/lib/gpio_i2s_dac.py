from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
from typing import NamedTuple


FEATURE = "gpio-i2s-dac"
MANIFEST_VERSION = "1"
BLOCK_VERSION = "1"
BEGIN = "# BEGIN EIDETIC MANAGED GPIO I2S DAC"
OVERLAY = "dtoverlay=i2s-dac"
END = "# END EIDETIC MANAGED GPIO I2S DAC"
BACKUP_KEY = "gpio-i2s-dac-config-v1"
MANIFEST_HEADER = "# eidetic-system-ui-manifest-v1\n"
FEATURE_PREFIX = f"feature\t{FEATURE}\t"
SECTION_RE = re.compile(r"^\s*\[([^\]]+)\]\s*$", re.IGNORECASE)
OVERLAY_RE = re.compile(
    r"^\s*dtoverlay\s*=\s*([A-Za-z0-9._+-]+)\s*$", re.IGNORECASE
)
CONFLICT_RE = re.compile(
    r"(hifiberry|iqaudio|allo|justboom|audioinjector|dacberry|"
    r"simple[-_]?audio[-_]?card|rpi[-_]?dac|dac|i2s|audio)",
    re.IGNORECASE,
)


class DacError(RuntimeError):
    pass


class FeatureRecord(NamedTuple):
    status: str
    logical: str
    backup_key: str
    original_hash: str
    managed_hash: str


class Inspection(NamedTuple):
    state: str
    config: Path | None
    logical: str
    overlay: Path | None
    data: bytes | None
    block_span: tuple[int, int] | None
    record: FeatureRecord | None


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def target(root: Path, logical: str) -> Path:
    return root / logical.lstrip("/")


def manifest_path(root: Path) -> Path:
    return target(root, "/var/lib/eidetic-player/system-ui-manifest-v1.tsv")


def backups_path(root: Path) -> Path:
    return target(root, "/var/lib/eidetic-player/backups")


def transaction_path(root: Path, session: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", session):
        raise DacError("invalid GPIO/I2S transaction identifier")
    return target(
        root, f"/var/lib/eidetic-player/gpio-i2s-dac-session-{session}.json"
    )


def fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_write(
    path: Path,
    data: bytes,
    *,
    mode: int,
    uid: int | None,
    gid: int | None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.eidetic-", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, mode)
        if uid is not None and gid is not None and hasattr(os, "fchown"):
            os.fchown(descriptor, uid, gid)
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            descriptor = -1
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        temporary.unlink(missing_ok=True)


def read_manifest(root: Path) -> tuple[list[str], FeatureRecord | None]:
    path = manifest_path(root)
    if not path.exists():
        return [], None
    if path.is_symlink() or not path.is_file():
        raise DacError("Eidetic managed manifest is not a regular file")
    lines = path.read_text(encoding="utf-8").splitlines()
    feature_lines = [line for line in lines if line.startswith(FEATURE_PREFIX)]
    if len(feature_lines) > 1:
        raise DacError("duplicate GPIO/I2S feature ownership records")
    if not feature_lines:
        return lines, None
    fields = feature_lines[0].split("\t")
    if (
        len(fields) != 9
        or fields[:3] != ["feature", FEATURE, MANIFEST_VERSION]
        or fields[8] != BLOCK_VERSION
    ):
        raise DacError("invalid GPIO/I2S feature ownership record")
    return lines, FeatureRecord(*fields[3:8])


def write_feature_record(root: Path, record: FeatureRecord | None) -> None:
    path = manifest_path(root)
    lines, _ = read_manifest(root)
    retained = [line for line in lines if not line.startswith(FEATURE_PREFIX)]
    if not retained:
        retained = [MANIFEST_HEADER.rstrip("\n")]
    if record is not None:
        values = (
            "feature",
            FEATURE,
            MANIFEST_VERSION,
            *record,
            BLOCK_VERSION,
        )
        retained.append("\t".join(values))
    payload = ("\n".join(retained) + "\n").encode()
    if path.exists():
        metadata = path.stat()
        mode = stat.S_IMODE(metadata.st_mode)
        uid = metadata.st_uid
        gid = metadata.st_gid
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        if os.name != "nt":
            os.chmod(path.parent, 0o750)
        mode, uid, gid = 0o640, None, None
    atomic_write(path, payload, mode=mode, uid=uid, gid=gid)


def decode_line(line: bytes) -> str:
    return line.rstrip(b"\r\n").decode("utf-8", "surrogateescape")


def active_line(line: bytes) -> str | None:
    value = decode_line(line).strip()
    if not value or value.startswith(("#", ";")):
        return None
    return value


def find_block(lines: list[bytes]) -> tuple[tuple[int, int] | None, bool]:
    begins = [index for index, line in enumerate(lines) if decode_line(line).strip() == BEGIN]
    ends = [index for index, line in enumerate(lines) if decode_line(line).strip() == END]
    if not begins and not ends:
        return None, False
    if len(begins) != 1 or len(ends) != 1:
        return None, True
    begin, end = begins[0], ends[0]
    if end != begin + 2 or decode_line(lines[begin + 1]).strip() != OVERLAY:
        return None, True
    if (
        decode_line(lines[begin]) != BEGIN
        or decode_line(lines[begin + 1]) != OVERLAY
        or decode_line(lines[end]) != END
    ):
        return None, True
    start = sum(len(line) for line in lines[:begin])
    finish = sum(len(line) for line in lines[: end + 1])
    return (start, finish), False


def overlay_states(
    lines: list[bytes], block_span: tuple[int, int] | None
) -> tuple[int, list[str]]:
    preexisting = 0
    conflicts: list[str] = []
    offset = 0
    for line in lines:
        start, finish = offset, offset + len(line)
        offset = finish
        if block_span is not None and start >= block_span[0] and finish <= block_span[1]:
            continue
        value = active_line(line)
        if value is None:
            continue
        match = OVERLAY_RE.fullmatch(value)
        if match is None:
            continue
        name = match.group(1).lower()
        if name == "i2s-dac":
            preexisting += 1
        elif name not in {"vc4-kms-v3d", "vc4-fkms-v3d"} and CONFLICT_RE.search(name):
            conflicts.append(name)
    return preexisting, conflicts


def select_boot(root: Path) -> tuple[Path | None, str, Path | None]:
    choices = (
        (
            target(root, "/boot/firmware/config.txt"),
            "/boot/firmware/config.txt",
            target(root, "/boot/firmware/overlays/i2s-dac.dtbo"),
        ),
        (
            target(root, "/boot/config.txt"),
            "/boot/config.txt",
            target(root, "/boot/overlays/i2s-dac.dtbo"),
        ),
    )
    for config, logical, overlay in choices:
        if config.exists() or config.is_symlink():
            return config, logical, overlay
    return None, "-", None


def inspect(root: Path, raspberry: bool) -> Inspection:
    lines, record = read_manifest(root)
    del lines
    if not raspberry:
        return Inspection(
            "unsupported-platform", None, "-", None, None, None, record
        )
    config, logical, overlay = select_boot(root)
    if config is None:
        return Inspection("unsupported-platform", None, "-", None, None, None, record)
    if config.is_symlink() or not config.is_file():
        return Inspection("failed", config, logical, overlay, None, None, record)
    if not os.access(config, os.R_OK):
        return Inspection("failed", config, logical, overlay, None, None, record)
    data = config.read_bytes()
    if not data:
        return Inspection("failed", config, logical, overlay, data, None, record)
    if overlay is None or overlay.is_symlink() or not overlay.is_file():
        return Inspection(
            "overlay-unavailable", config, logical, overlay, data, None, record
        )
    content_lines = data.splitlines(keepends=True)
    block_span, malformed = find_block(content_lines)
    if malformed:
        return Inspection("conflict", config, logical, overlay, data, None, record)
    preexisting, conflicts = overlay_states(content_lines, block_span)
    if conflicts or preexisting > 1 or (preexisting and block_span is not None):
        return Inspection(
            "conflict", config, logical, overlay, data, block_span, record
        )
    if block_span is not None:
        if (
            record is not None
            and record.status == "managed"
            and record.logical == logical
            and record.backup_key == BACKUP_KEY
        ):
            return Inspection(
                "managed", config, logical, overlay, data, block_span, record
            )
        return Inspection(
            "managed-unowned", config, logical, overlay, data, block_span, record
        )
    if preexisting == 1:
        return Inspection(
            "preexisting", config, logical, overlay, data, None, record
        )
    return Inspection("absent", config, logical, overlay, data, None, record)


def newline_for(data: bytes) -> bytes:
    lf = data.find(b"\n")
    if lf > 0 and data[lf - 1 : lf + 1] == b"\r\n":
        return b"\r\n"
    return b"\n"


def insertion_candidate(data: bytes) -> tuple[bytes, int, bytes]:
    lines = data.splitlines(keepends=True)
    newline = newline_for(data)
    all_sections: list[int] = []
    for index, line in enumerate(lines):
        value = active_line(line)
        if value is None:
            continue
        match = SECTION_RE.fullmatch(value)
        if match and match.group(1).lower() == "all":
            all_sections.append(index)
    if all_sections:
        section = all_sections[-1]
        insertion_line = len(lines)
        for index in range(section + 1, len(lines)):
            value = active_line(lines[index])
            if value is not None and SECTION_RE.fullmatch(value):
                insertion_line = index
                break
        offset = sum(len(line) for line in lines[:insertion_line])
        prefix = b""
        if offset and not data[:offset].endswith((b"\n", b"\r")):
            prefix += newline
        preceding = data[:offset].splitlines()
        if preceding and preceding[-1].strip():
            prefix += newline
        suffix = newline if offset < len(data) else b""
        inserted = (
            prefix
            + BEGIN.encode()
            + newline
            + OVERLAY.encode()
            + newline
            + END.encode()
            + newline
            + suffix
        )
    else:
        offset = len(data)
        prefix = b""
        if data and not data.endswith((b"\n", b"\r")):
            prefix += newline
        if data and data.rstrip(b"\r\n"):
            prefix += newline
        inserted = (
            prefix
            + b"[all]"
            + newline
            + BEGIN.encode()
            + newline
            + OVERLAY.encode()
            + newline
            + END.encode()
            + newline
        )
    return data[:offset] + inserted + data[offset:], offset, inserted


def validate_added(
    original: bytes, candidate: bytes, offset: int, inserted: bytes
) -> tuple[int, int]:
    if candidate[:offset] + candidate[offset + len(inserted) :] != original:
        raise DacError("unmanaged boot configuration content changed")
    span, malformed = find_block(candidate.splitlines(keepends=True))
    if malformed or span is None:
        raise DacError("managed GPIO/I2S block validation failed")
    preexisting, conflicts = overlay_states(candidate.splitlines(keepends=True), span)
    if preexisting or conflicts:
        raise DacError("GPIO/I2S post-write overlay validation failed")
    if original.count(b"dtparam=audio=on") != candidate.count(b"dtparam=audio=on"):
        raise DacError("onboard audio configuration changed")
    return span


def copy_verified_backup(source: Path, backup: Path) -> None:
    if backup.exists():
        raise DacError("unowned GPIO/I2S backup already exists")
    backup.parent.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        os.chmod(backup.parent, 0o750)
    temporary = backup.with_name(f".{backup.name}.eidetic-new")
    temporary.unlink(missing_ok=True)
    try:
        shutil.copy2(source, temporary)
        if hasattr(os, "chown"):
            metadata = source.stat()
            os.chown(temporary, metadata.st_uid, metadata.st_gid)
        if temporary.read_bytes() != source.read_bytes():
            raise DacError("GPIO/I2S backup verification failed")
        os.replace(temporary, backup)
        fsync_directory(backup.parent)
    finally:
        temporary.unlink(missing_ok=True)


def record_nonmanaged(root: Path, state: str, logical: str) -> None:
    status = (
        "unavailable"
        if state in {"overlay-unavailable", "unsupported-platform"}
        else state
    )
    write_feature_record(root, FeatureRecord(status, logical, "-", "-", "-"))


def apply(root: Path, raspberry: bool, session: str) -> str:
    result = inspect(root, raspberry)
    if result.state in {
        "unsupported-platform",
        "overlay-unavailable",
        "preexisting",
        "managed-unowned",
        "conflict",
    }:
        record_nonmanaged(root, result.state, result.logical)
        return result.state
    if result.state == "managed":
        assert result.record is not None
        backup = backups_path(root) / result.record.backup_key
        if (
            not backup.is_file()
            or backup.is_symlink()
            or sha256_bytes(backup.read_bytes()) != result.record.original_hash
        ):
            raise DacError("managed GPIO/I2S original backup is unavailable")
        return "managed"
    if result.state != "absent" or result.config is None or result.data is None:
        raise DacError("GPIO/I2S boot configuration is unsafe")
    config = result.config
    if not os.access(config.parent, os.W_OK):
        raise DacError("GPIO/I2S boot configuration directory is not writable")
    metadata = config.stat()
    original = result.data
    candidate, offset, inserted = insertion_candidate(original)
    validate_added(original, candidate, offset, inserted)
    backup = backups_path(root) / BACKUP_KEY
    copy_verified_backup(config, backup)
    original_hash = sha256_bytes(original)
    managed_hash = sha256_bytes(candidate)
    try:
        atomic_write(
            config,
            candidate,
            mode=stat.S_IMODE(metadata.st_mode),
            uid=metadata.st_uid,
            gid=metadata.st_gid,
        )
        reread = config.read_bytes()
        validate_added(original, reread, offset, inserted)
        after = config.stat()
        if stat.S_IMODE(after.st_mode) != stat.S_IMODE(metadata.st_mode):
            raise DacError("GPIO/I2S boot configuration mode changed")
        if os.name != "nt" and (
            after.st_uid != metadata.st_uid or after.st_gid != metadata.st_gid
        ):
            raise DacError("GPIO/I2S boot configuration ownership changed")
        write_feature_record(
            root,
            FeatureRecord(
                "managed", result.logical, BACKUP_KEY, original_hash, managed_hash
            ),
        )
        transaction = {
            "version": 1,
            "logical": result.logical,
            "backup_key": BACKUP_KEY,
            "original_hash": original_hash,
            "managed_hash": managed_hash,
        }
        path = transaction_path(root, session)
        atomic_write(
            path,
            (json.dumps(transaction, sort_keys=True) + "\n").encode(),
            mode=0o600,
            uid=None,
            gid=None,
        )
    except Exception:
        atomic_write(
            config,
            original,
            mode=stat.S_IMODE(metadata.st_mode),
            uid=metadata.st_uid,
            gid=metadata.st_gid,
        )
        write_feature_record(root, None)
        backup.unlink(missing_ok=True)
        raise
    return "added"


def load_transaction(root: Path, session: str) -> tuple[Path, dict[str, object]]:
    path = transaction_path(root, session)
    if path.is_symlink() or not path.is_file():
        raise DacError("GPIO/I2S installation transaction is unavailable")
    transaction = json.loads(path.read_text(encoding="utf-8"))
    if (
        not isinstance(transaction, dict)
        or transaction.get("version") != 1
        or transaction.get("logical")
        not in {"/boot/firmware/config.txt", "/boot/config.txt"}
        or transaction.get("backup_key") != BACKUP_KEY
    ):
        raise DacError("invalid GPIO/I2S installation transaction")
    return path, transaction


def rollback(root: Path, session: str) -> str:
    path, transaction = load_transaction(root, session)
    logical = str(transaction["logical"])
    config = target(root, logical)
    backup = backups_path(root) / BACKUP_KEY
    if config.is_symlink() or not config.is_file():
        raise DacError("GPIO/I2S rollback target is unsafe")
    current = config.read_bytes()
    original = backup.read_bytes()
    if sha256_bytes(current) != transaction["managed_hash"]:
        raise DacError("GPIO/I2S rollback refused after an external config change")
    if sha256_bytes(original) != transaction["original_hash"]:
        raise DacError("GPIO/I2S rollback backup checksum mismatch")
    metadata = backup.stat()
    atomic_write(
        config,
        original,
        mode=stat.S_IMODE(metadata.st_mode),
        uid=metadata.st_uid,
        gid=metadata.st_gid,
    )
    if config.read_bytes() != original:
        raise DacError("GPIO/I2S rollback verification failed")
    write_feature_record(root, None)
    backup.unlink(missing_ok=True)
    path.unlink(missing_ok=True)
    return "rolled-back"


def commit(root: Path, session: str) -> str:
    path = transaction_path(root, session)
    path.unlink(missing_ok=True)
    return "committed"


def remove(root: Path, raspberry: bool) -> str:
    result = inspect(root, raspberry)
    if result.state != "managed":
        return f"preserved-{result.state}"
    assert (
        result.config is not None
        and result.data is not None
        and result.block_span is not None
        and result.record is not None
    )
    start, finish = result.block_span
    original = result.data
    candidate = original[:start] + original[finish:]
    if candidate == original:
        raise DacError("GPIO/I2S managed block removal made no change")
    metadata = result.config.stat()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = backups_path(root) / f"gpio-i2s-dac-pre-removal-{timestamp}"
    copy_verified_backup(result.config, backup)
    try:
        atomic_write(
            result.config,
            candidate,
            mode=stat.S_IMODE(metadata.st_mode),
            uid=metadata.st_uid,
            gid=metadata.st_gid,
        )
        if result.config.read_bytes() != candidate:
            raise DacError("GPIO/I2S managed block removal verification failed")
        after = result.config.stat()
        if stat.S_IMODE(after.st_mode) != stat.S_IMODE(metadata.st_mode):
            raise DacError("GPIO/I2S removal changed boot configuration mode")
        if os.name != "nt" and (
            after.st_uid != metadata.st_uid or after.st_gid != metadata.st_gid
        ):
            raise DacError("GPIO/I2S removal changed boot configuration ownership")
        write_feature_record(root, None)
    except Exception:
        atomic_write(
            result.config,
            original,
            mode=stat.S_IMODE(metadata.st_mode),
            uid=metadata.st_uid,
            gid=metadata.st_gid,
        )
        raise
    (backups_path(root) / result.record.backup_key).unlink(missing_ok=True)
    return "removed"


def main() -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument(
        "command", choices=("inspect", "apply", "rollback", "commit", "remove")
    )
    parser.add_argument("--root", required=True)
    parser.add_argument("--raspberry", action="store_true")
    parser.add_argument("--session")
    arguments = parser.parse_args()
    root = Path(arguments.root).resolve()
    if not root.is_absolute() or not root.is_dir():
        raise DacError("GPIO/I2S root must be an existing absolute directory")
    if root == Path("/") and arguments.command in {"apply", "rollback", "remove"}:
        if getattr(os, "geteuid", lambda: 1)() != 0:
            raise DacError("real GPIO/I2S changes require root")
    if arguments.command == "inspect":
        print(inspect(root, arguments.raspberry).state)
    elif arguments.command == "apply":
        if not arguments.session:
            raise DacError("--session is required for GPIO/I2S apply")
        print(apply(root, arguments.raspberry, arguments.session))
    elif arguments.command == "rollback":
        if not arguments.session:
            raise DacError("--session is required for GPIO/I2S rollback")
        print(rollback(root, arguments.session))
    elif arguments.command == "commit":
        if not arguments.session:
            raise DacError("--session is required for GPIO/I2S commit")
        print(commit(root, arguments.session))
    else:
        print(remove(root, arguments.raspberry))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (DacError, OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=__import__("sys").stderr)
        raise SystemExit(1) from None
