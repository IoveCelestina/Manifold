"""Exercise real backup/restore scripts in disposable directories.

Docker and GPG are local test doubles: no containers, credentials or servers are
touched. Tar and SQLite are real, including a database with uncheckpointed WAL.
Run with Python 3.10+: --backend bash (Linux) or --backend powershell (Windows).
"""

import argparse
from contextlib import closing
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import unittest


PARSER = argparse.ArgumentParser()
PARSER.add_argument("--backend", choices=("bash", "powershell"), required=True)
OPTIONS, REMAINING = PARSER.parse_known_args()
REPO = Path(__file__).resolve().parents[2]
DUMP = b"test-postgres-dump\n" * 32

# Native executable needed by PowerShell's ProcessStartInfo stream helpers.
WINDOWS_TOOL = r'''
using System;
using System.IO;
using System.Reflection;
class FixtureTool {
    static int Main(string[] args) {
        string tool = Path.GetFileNameWithoutExtension(Assembly.GetExecutingAssembly().Location);
        if (tool == "docker" && !String.Equals(
            Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location),
            Environment.GetEnvironmentVariable("TEST_DOCKER_BIN"), StringComparison.OrdinalIgnoreCase)) {
            Console.Error.WriteLine("Unexpected fixture executable: " + Assembly.GetExecutingAssembly().Location);
            Console.Error.WriteLine("Expected fixture directory: " + Environment.GetEnvironmentVariable("TEST_DOCKER_BIN"));
            return 95;
        }
        if (tool == "gpg") {
            int output = Array.IndexOf(args, "--output");
            if (output < 0) return 90;
            File.Copy(args[args.Length - 1], args[output + 1], true);
            return 0;
        }
        File.AppendAllText(Environment.GetEnvironmentVariable("TEST_DOCKER_LOG"),
            Environment.GetEnvironmentVariable("MANIFOLD_DATA_DIR") + "\t" + String.Join("\t", args) + "\n");
        if (args[0] == "inspect") {
            Console.WriteLine(args[2].Contains("Running") ? "true" : "healthy"); return 0;
        }
        if (args[0] == "compose") {
            if (args[1] == "down" && Environment.GetEnvironmentVariable("TEST_STOP_FAIL") == "1") return 9;
            if (args[1] == "config") Console.WriteLine("postgres\nredis\nsub2api\ndevin2api");
            return 0;
        }
        if (args[0] == "exec" && Array.IndexOf(args, "pg_dump") >= 0) {
            byte[] data = System.Text.Encoding.UTF8.GetBytes("test-postgres-dump\n");
            using (Stream output = Console.OpenStandardOutput())
                for (int i = 0; i < 32; i++) output.Write(data, 0, data.Length);
            return 0;
        }
        if (args[0] == "exec" && Array.IndexOf(args, "pg_restore") >= 0) {
            using (Stream output = File.Create(Environment.GetEnvironmentVariable("TEST_RESTORED_DUMP")))
                Console.OpenStandardInput().CopyTo(output);
            return 0;
        }
        return 91;
    }
}
'''

POSIX_DOCKER = r'''#!/usr/bin/env python3
import os, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ["TEST_DOCKER_LOG"], "a") as log:
    log.write(os.environ.get("MANIFOLD_DATA_DIR", "") + "\t" + "\t".join(args) + "\n")
if args[0] == "inspect":
    print("true" if "Running" in args[2] else "healthy")
elif args[0] == "compose":
    if args[1] == "down" and os.environ.get("TEST_STOP_FAIL") == "1":
        sys.exit(9)
    if args[1] == "config":
        print("postgres\nredis\nsub2api\ndevin2api")
elif args[0] == "exec" and "pg_dump" in args:
    sys.stdout.buffer.write(b"test-postgres-dump\n" * 32)
elif args[0] == "exec" and "pg_restore" in args:
    Path(os.environ["TEST_RESTORED_DUMP"]).write_bytes(sys.stdin.buffer.read())
else:
    sys.exit(91)
'''


class BackupRestoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shared = tempfile.TemporaryDirectory(prefix="manifold-test-tools-")
        # Hosted Windows runners may expose TEMP through an 8.3 short name;
        # .NET expands executable paths, so compare canonical directory names.
        cls.bin = Path(cls.shared.name).resolve()
        if OPTIONS.backend == "powershell":
            if os.name != "nt":
                raise unittest.SkipTest("The native PowerShell fixture requires Windows")
            compiler = Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
            source = cls.bin / "FixtureTool.cs"
            source.write_text(WINDOWS_TOOL, encoding="utf-8")
            subprocess.run([str(compiler), "/nologo", f"/out:{cls.bin / 'docker.exe'}", str(source)], check=True)
            shutil.copyfile(cls.bin / "docker.exe", cls.bin / "gpg.exe")
        else:
            stub = cls.bin / "docker"
            stub.write_text(POSIX_DOCKER, encoding="utf-8")
            stub.chmod(0o755)

    @classmethod
    def tearDownClass(cls):
        cls.shared.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="manifold-restore-test-")
        self.root = Path(self.temp.name).resolve()
        self.project = self.root / "project"
        self.deploy = self.project / "deploy"
        self.deploy.mkdir(parents=True)
        (self.project / "scripts").mkdir()
        for name in ("backup.sh", "restore.sh", "backup.ps1", "restore.ps1"):
            shutil.copyfile(REPO / "scripts" / name, self.project / "scripts" / name)
        (self.deploy / "docker-compose.yml").write_text("services: {}\n", encoding="utf-8")
        self.env = os.environ.copy()
        for key in ("MANIFOLD_DATA_DIR", "RCLONE_REMOTE", "GPG_RECIPIENT", "POSTGRES_CONTAINER", "TEST_STOP_FAIL"):
            self.env.pop(key, None)
        # Avoid Windows App Execution Aliases masking the actual test Python.
        path = [p for p in self.env.get("PATH", "").split(os.pathsep) if "WindowsApps" not in p]
        self.env["PATH"] = os.pathsep.join([str(self.bin), str(Path(sys.executable).parent), *path])
        self.env["BACKUP_DIR"] = str(self.root / "backups")
        self.env["TEST_DOCKER_LOG"] = str(self.root / "docker.log")
        self.env["TEST_RESTORED_DUMP"] = str(self.root / "restored.dump")
        self.env["TEST_DOCKER_BIN"] = str(self.bin)
        if os.name == "nt":
            # Native CreateProcess prefers the CWD to PATH. This decoy fails
            # if a stream helper bypasses PowerShell's executable resolution.
            shutil.copyfile(self.bin / "docker.exe", self.root / "docker.exe")

    def tearDown(self):
        # Cleanup is restricted to the absolute temporary directory we created.
        assert self.root.parent == Path(tempfile.gettempdir()).resolve()
        assert self.root.name.startswith("manifold-restore-test-")
        self.temp.cleanup()

    def write(self, path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def database(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(path)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE state (value TEXT)")
        connection.execute("INSERT INTO state VALUES (?)", (value,))
        connection.commit()
        return connection

    def run_script(self, operation, archive=None, force=False, expected=0):
        if OPTIONS.backend == "bash":
            command = ["bash", str(self.project / "scripts" / f"{operation}.sh")]
            if operation == "backup":
                command += ["--no-encrypt"]
            else:
                command += (["--force", "--yes"] if force else []) + [str(archive)]
        else:
            command = ["pwsh", "-NoProfile", "-File", str(self.project / "scripts" / f"{operation}.ps1")]
            if operation == "backup":
                command += ["-GpgRecipient", "fixture@example.invalid", "-BackupDir", self.env["BACKUP_DIR"]]
            else:
                command += ["-BackupPath", str(archive)] + (["-Force", "-Yes"] if force else [])
        result = subprocess.run(command, env=self.env, cwd=self.root, capture_output=True, timeout=40)
        self.assertEqual(result.returncode, expected, result.stdout.decode("utf-8", "replace") + result.stderr.decode("utf-8", "replace"))
        return result

    def archive(self, include_env=True, include_devin=True):
        stage = self.root / "archive-stage"
        self.write(stage / "MANIFEST.txt", "fixture backup\n")
        (stage / "postgres.dump").write_bytes(DUMP)
        if include_env:
            self.write(stage / "configs/.env", "POSTGRES_USER=sub2api\nPOSTGRES_DB=sub2api\nMANIFOLD_DATA_DIR=/old-machine/data\n")
        if include_devin:
            self.database(stage / "data/devin2api/devin-2api.db", "backup-value").close()
            self.write(stage / "configs/devin2api-config.yaml", "fixture: true\n")
        archive = self.root / "fixture.tar.gz"
        with tarfile.open(archive, "w:gz") as output:
            output.add(stage, arcname=".")
        return archive

    def assert_restored(self, data_root):
        with closing(sqlite3.connect(data_root / "devin2api/devin-2api.db")) as connection:
            self.assertEqual(connection.execute("SELECT value FROM state").fetchall(), [("backup-value",)])
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone(), ("ok",))
        self.assertFalse((data_root / "devin2api/devin2api").exists())
        self.assertFalse((data_root / "devin2api/stale-marker").exists())
        self.assertIn(f"MANIFOLD_DATA_DIR={data_root}", (self.deploy / ".env").read_text(encoding="utf-8"))
        self.assertEqual((self.root / "restored.dump").read_bytes(), DUMP)
        if os.name == "nt":
            environment = self.env | {"TEST_SECRET_FILE": str(self.deploy / ".env")}
            check_acl = r'''
                $acl = Get-Acl -LiteralPath $env:TEST_SECRET_FILE
                $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
                $rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
                if (-not $acl.AreAccessRulesProtected -or $rules.Count -ne 1 -or
                    $rules[0].IdentityReference -ne $sid -or
                    $rules[0].FileSystemRights -ne 'FullControl') { exit 1 }
            '''
            subprocess.run(["pwsh", "-NoProfile", "-Command", check_acl], env=environment, check=True)
        else:
            self.assertEqual((self.deploy / ".env").stat().st_mode & 0o777, 0o600)

    def roundtrip(self, mode):
        source = self.deploy / "data"
        config = "POSTGRES_USER=sub2api\nPOSTGRES_DB=sub2api\n"
        if mode == "dotenv":
            source = self.deploy / "relative data"
            config += "MANIFOLD_DATA_DIR=./relative data\n"
        elif mode == "environment":
            source = self.root / "external source"
            config += "MANIFOLD_DATA_DIR=./wrong-directory\n"
            self.env["MANIFOLD_DATA_DIR"] = str(source)
        self.write(self.deploy / ".env", config)
        self.write(self.deploy / "devin2api/config.yaml", "fixture: true\n")
        self.write(source / "sub2api/token-fixture", "backup-token")
        connection = self.database(source / "devin2api/devin-2api.db", "backup-value")
        try:
            self.assertGreater((source / "devin2api/devin-2api.db-wal").stat().st_size, 0)
            self.run_script("backup")
        finally:
            connection.close()
        archive = next((self.root / "backups").glob("manifold-*.tar.gz*"))
        # GPG is deliberately a copy-only double; inspect the actual tar contents.
        with tarfile.open(archive) as contents:
            self.assertEqual(contents.extractfile("./data/sub2api/token-fixture").read(), b"backup-token")
            snapshot = self.root / "snapshot.db"
            snapshot.write_bytes(contents.extractfile("./data/devin2api/devin-2api.db").read())
        with closing(sqlite3.connect(snapshot)) as check:
            self.assertEqual(check.execute("SELECT value FROM state").fetchone(), ("backup-value",))
        target = source if mode == "default" else self.root / "different host data"
        if mode != "default":
            self.env["MANIFOLD_DATA_DIR"] = str(target)
            self.database(target / "devin2api/devin-2api.db", "old-value").close()
        else:
            with closing(sqlite3.connect(target / "devin2api/devin-2api.db")) as old:
                old.execute("UPDATE state SET value='old-value'")
                old.commit()
        self.write(target / "devin2api/stale-marker", "old")
        self.write(target / "devin2api/devin-2api.db-wal", "stale WAL")
        self.write(target / "devin2api/devin-2api.db-shm", "stale SHM")
        self.write(target / "unrelated/keep", "untouched")
        self.run_script("restore", archive, force=True)
        self.assertFalse((target / "devin2api/devin-2api.db-wal").exists())
        self.assertFalse((target / "devin2api/devin-2api.db-shm").exists())
        self.assert_restored(target)
        self.assertEqual((target / "unrelated/keep").read_text(), "untouched")
        self.assertIn(str(target) + "\tcompose\tdown", (self.root / "docker.log").read_text())
        # A second overwrite must not create nested directories either.
        self.run_script("restore", archive, force=True)
        self.assert_restored(target)

    def test_default_roundtrip(self):
        self.roundtrip("default")

    def test_dotenv_relative_roundtrip(self):
        self.roundtrip("dotenv")

    def test_environment_override_roundtrip(self):
        self.roundtrip("environment")

    def test_devin_only_existing_data_requires_force(self):
        target = self.deploy / "data"
        self.write(target / "devin2api/keep", "untouched")
        self.run_script("restore", self.archive(), expected=3)
        self.assertEqual((target / "devin2api/keep").read_text(), "untouched")
        self.assertFalse((self.root / "docker.log").exists())

    def test_failed_stop_preserves_data(self):
        self.env["TEST_STOP_FAIL"] = "1"
        self.write(self.deploy / ".env", "POSTGRES_USER=sub2api\n")
        self.write(self.deploy / "data/devin2api/keep", "untouched")
        self.run_script("restore", self.archive(), force=True, expected=9 if OPTIONS.backend == "bash" else 1)
        self.assertEqual((self.deploy / "data/devin2api/keep").read_text(), "untouched")
        self.assertEqual((self.deploy / ".env").read_text(), "POSTGRES_USER=sub2api\n")

    def test_incomplete_archive_preserves_data(self):
        self.write(self.deploy / ".env", "POSTGRES_USER=sub2api\n")
        self.write(self.deploy / "data/devin2api/keep", "untouched")
        self.run_script("restore", self.archive(include_env=False), force=True, expected=1)
        self.assertEqual((self.deploy / "data/devin2api/keep").read_text(), "untouched")
        self.assertFalse((self.root / "docker.log").exists())

    def test_unsafe_deploy_root_is_rejected(self):
        self.env["MANIFOLD_DATA_DIR"] = str(self.deploy)
        self.run_script("restore", self.archive(), force=True, expected=1)
        self.assertFalse((self.root / "docker.log").exists())

    def test_fresh_restore(self):
        self.run_script("restore", self.archive())
        self.assert_restored(self.deploy / "data")

    def test_legacy_backup_without_devin(self):
        self.run_script("restore", self.archive(include_devin=False))
        self.assertFalse((self.deploy / "data/devin2api").exists())
        log = (self.root / "docker.log").read_text()
        up = [line for line in log.splitlines() if "\tcompose\tup" in line]
        self.assertTrue(up)
        self.assertTrue(all("devin2api" not in line for line in up))


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0], *REMAINING], verbosity=2)
