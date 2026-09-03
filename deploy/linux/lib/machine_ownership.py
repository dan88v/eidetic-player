"""Atomic, root-owned machine ownership state for Raspberry Pi OS Lite."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import pwd
import stat
import tempfile
from typing import Any

SCHEMA_VERSION = 1
LOGICAL_MANIFEST = pathlib.PurePosixPath(
    "/var/lib/eidetic-player/machine-ownership-v1.json"
)
MANAGED_PATHS = (
    "/etc/systemd/system/getty@tty1.service.d/90-eidetic-player-autologin.conf",
    "/etc/profile.d/eidetic-player-session.sh",
    "/etc/systemd/user/eidetic-graphical-session.target",
    "/etc/systemd/user/eidetic-labwc.service",
    "/etc/systemd/user/eidetic-player.service.d/50-eidetic-lite-graphical.conf",
    "/etc/eidetic-player/labwc/rc.xml",
    "/usr/local/bin/eidetic-player-session",
    "/usr/libexec/eidetic-player-graphical-launch",
)


class ManifestError(RuntimeError):
    pass


def rooted(root: pathlib.Path, logical: str | pathlib.PurePosixPath) -> pathlib.Path:
    value = pathlib.PurePosixPath(logical)
    if not value.is_absolute() or ".." in value.parts:
        raise ManifestError(f"unsafe logical path: {value}")
    return root / value.relative_to("/")


def regular_details(path: pathlib.Path) -> dict[str, Any]:
    try:
        details = path.lstat()
    except FileNotFoundError:
        return {"exists": False}
    if stat.S_ISLNK(details.st_mode):
        raise ManifestError(f"refusing symbolic link: {path}")
    if not stat.S_ISREG(details.st_mode):
        raise ManifestError(f"expected regular file: {path}")
    return {
        "exists": True,
        "mode": format(stat.S_IMODE(details.st_mode), "04o"),
        "uid": details.st_uid,
        "gid": details.st_gid,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def read_lines(path: pathlib.Path) -> list[str]:
    if not path.exists():
        return []
    if path.is_symlink() or not path.is_file():
        raise ManifestError(f"unsafe package state file: {path}")
    values = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    for value in values:
        if value and not all(ch.islower() or ch.isdigit() or ch in "+.-" for ch in value):
            raise ManifestError(f"invalid package value: {value}")
    return sorted(set(filter(None, values)))


def read_versions(path: pathlib.Path) -> dict[str, str]:
    if path.is_symlink() or not path.is_file():
        raise ManifestError(f"unsafe package version file: {path}")
    result: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        package, separator, version = line.partition("\t")
        if not separator or not package or not version or package in result:
            raise ManifestError("invalid or duplicate package version record")
        if not all(ch.islower() or ch.isdigit() or ch in "+.-" for ch in package):
            raise ManifestError(f"invalid package value: {package}")
        if len(version) > 128 or not all(
            ch.isalnum() or ch in "+.:~_-$" for ch in version
        ):
            raise ManifestError(f"invalid package version: {package}")
        result[package] = version
    return dict(sorted(result.items()))


def validate_document(document: dict[str, Any]) -> None:
    if document.get("schemaVersion") != SCHEMA_VERSION:
        raise ManifestError("unsupported machine ownership schema")
    if document.get("installProfile") != "raspios-lite":
        raise ManifestError("machine ownership profile is not raspios-lite")
    user = document.get("runtimeUser")
    if not isinstance(user, dict) or not isinstance(user.get("uid"), int):
        raise ManifestError("invalid runtime user record")
    if user["uid"] <= 0 or not str(user.get("home", "")).startswith("/"):
        raise ManifestError("unsafe runtime user record")
    files = document.get("configFiles")
    if not isinstance(files, list):
        raise ManifestError("invalid config file records")
    allowed = set(MANAGED_PATHS)
    for record in files:
        if not isinstance(record, dict) or record.get("path") not in allowed:
            raise ManifestError("machine manifest contains a non-allowlisted path")
    serialized = json.dumps(document, sort_keys=True)
    forbidden = ("password", "psk", "privatekey", "smbcredential", "token")
    folded = serialized.casefold()
    if any(secret in folded for secret in forbidden):
        raise ManifestError("machine manifest contains a forbidden credential field")


def capture(args: argparse.Namespace) -> None:
    root = pathlib.Path(args.root).resolve()
    output = pathlib.Path(args.output)
    if output.exists() and output.is_symlink():
        raise ManifestError("capture output must not be a symbolic link")
    before = {logical: regular_details(rooted(root, logical)) for logical in MANAGED_PATHS}
    default_target = rooted(root, "/etc/systemd/system/default.target")
    target_value = None
    if default_target.is_symlink():
        target_value = os.readlink(default_target)
    elif default_target.exists():
        target_value = "non-symlink"
    document = {
        "schemaVersion": SCHEMA_VERSION,
        "capturedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "defaultTarget": target_value,
        "configFiles": before,
    }
    output.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(output, 0o600)


def atomic_write(target: pathlib.Path, document: dict[str, Any], enforce_root: bool) -> None:
    parent = target.parent
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if parent.is_symlink() or not parent.is_dir():
        raise ManifestError("machine manifest parent is unsafe")
    os.chmod(parent, 0o700)
    if enforce_root and parent.stat().st_uid != 0:
        raise ManifestError("machine manifest parent must be root-owned")
    if target.exists() and (target.is_symlink() or not target.is_file()):
        raise ManifestError("machine manifest target is unsafe")
    fd, temporary_name = tempfile.mkstemp(prefix=".machine-ownership-v1.", dir=parent)
    temporary = pathlib.Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(document, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        if enforce_root:
            os.chown(temporary, 0, 0)
        os.replace(temporary, target)
        directory_fd = os.open(parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        temporary.unlink(missing_ok=True)


def commit(args: argparse.Namespace) -> None:
    root = pathlib.Path(args.root).resolve()
    before_path = pathlib.Path(args.before)
    if before_path.is_symlink() or not before_path.is_file():
        raise ManifestError("before-state capture is unsafe")
    before = json.loads(before_path.read_text(encoding="utf-8"))
    if before.get("schemaVersion") != SCHEMA_VERSION:
        raise ManifestError("invalid before-state schema")
    user = pwd.getpwnam(args.runtime_user)
    document = {
        "schemaVersion": SCHEMA_VERSION,
        "installProfile": "raspios-lite",
        "installerVersion": args.installer_version,
        "installedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "os": {
            "id": args.os_id,
            "versionId": args.os_version,
            "codename": args.os_codename,
            "architecture": args.architecture,
            "raspberryPiCompatible": args.compatible,
        },
        "runtimeUser": {
            "name": user.pw_name,
            "uid": user.pw_uid,
            "gid": user.pw_gid,
            "home": user.pw_dir,
        },
        "packages": {
            "manifestVersion": 1,
            "preExisting": read_lines(pathlib.Path(args.packages_pre_existing)),
            "installed": read_lines(pathlib.Path(args.packages_installed)),
            "versions": read_versions(pathlib.Path(args.package_versions)),
        },
        "services": {
            "preExisting": {},
            "created": [
                "eidetic-graphical-session.target",
                "eidetic-labwc.service",
            ],
            "stateChanges": ["getty@tty1.service daemon-reload required"],
        },
        "groups": {"membershipsPreExisting": [], "membershipsAdded": []},
        "getty": {
            "unit": "getty@tty1.service",
            "previous": before.get("configFiles", {}).get(MANAGED_PATHS[0], {}),
        },
        "autologin": {"runtimeUser": user.pw_name, "tty": "tty1"},
        "graphicalSession": {
            "target": "eidetic-graphical-session.target",
            "previousDefaultTarget": before.get("defaultTarget"),
        },
        "labwc": {"config": "/etc/eidetic-player/labwc/rc.xml"},
        "networkManager": {"classification": args.network_class},
        "pipeWire": {"required": True, "exclusiveRoute": False},
        "display": {"applicationOwned": True, "consoleBlankingManaged": True},
        "boot": {"changed": False},
        "airPlay": {"integrationVersion": args.airplay_version},
        "configFiles": [
            {
                "path": logical,
                "before": before.get("configFiles", {}).get(logical, {"exists": False}),
                "managed": regular_details(rooted(root, logical)),
            }
            for logical in MANAGED_PATHS
        ],
        "managedFileManifest": "/var/lib/eidetic-player/system-ui-manifest-v1.tsv",
    }
    validate_document(document)
    target = rooted(root, LOGICAL_MANIFEST)
    atomic_write(target, document, enforce_root=(root == pathlib.Path("/")))


def validate(args: argparse.Namespace) -> None:
    root = pathlib.Path(args.root).resolve()
    target = rooted(root, LOGICAL_MANIFEST)
    details = target.lstat()
    if not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode):
        raise ManifestError("machine manifest is not a regular file")
    if stat.S_IMODE(details.st_mode) != 0o600:
        raise ManifestError("machine manifest mode must be 0600")
    if root == pathlib.Path("/") and (details.st_uid != 0 or details.st_gid != 0):
        raise ManifestError("machine manifest must be root-owned")
    document = json.loads(target.read_text(encoding="utf-8"))
    validate_document(document)
    if args.print_profile:
        print(document["installProfile"])


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    commands = result.add_subparsers(dest="command", required=True)
    capture_parser = commands.add_parser("capture")
    capture_parser.add_argument("--root", required=True)
    capture_parser.add_argument("--output", required=True)
    capture_parser.set_defaults(handler=capture)
    commit_parser = commands.add_parser("commit")
    commit_parser.add_argument("--root", required=True)
    commit_parser.add_argument("--before", required=True)
    commit_parser.add_argument("--runtime-user", required=True)
    commit_parser.add_argument("--installer-version", required=True)
    commit_parser.add_argument("--os-id", required=True)
    commit_parser.add_argument("--os-version", required=True)
    commit_parser.add_argument("--os-codename", required=True)
    commit_parser.add_argument("--architecture", required=True)
    commit_parser.add_argument("--compatible", required=True)
    commit_parser.add_argument("--network-class", required=True)
    commit_parser.add_argument("--airplay-version", required=True)
    commit_parser.add_argument("--packages-pre-existing", required=True)
    commit_parser.add_argument("--packages-installed", required=True)
    commit_parser.add_argument("--package-versions", required=True)
    commit_parser.set_defaults(handler=commit)
    validate_parser = commands.add_parser("validate")
    validate_parser.add_argument("--root", required=True)
    validate_parser.add_argument("--print-profile", action="store_true")
    validate_parser.set_defaults(handler=validate)
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        args.handler(args)
    except (ManifestError, KeyError, OSError, ValueError, json.JSONDecodeError) as error:
        print(f"machine ownership error: {error}", file=os.sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
