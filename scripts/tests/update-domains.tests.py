"""Exercise domain updates and failure recovery without contacting a server."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASH = os.environ.get("TEST_BASH", "bash")
OLD_IMAGE = "sha256:" + "a" * 64


class DomainUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="domain-tests-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "checkout with spaces"
        self.deploy = self.root / "deploy"
        self.deploy.mkdir(parents=True)
        for name in ("docker-compose.yml", "Caddyfile"):
            shutil.copyfile(ROOT / "deploy" / name, self.deploy / name)
        self.original = (
            "# preserve unrelated settings\n"
            "POSTGRES_PASSWORD='fake-$(touch should-not-exist)'\n"
            "JWT_SECRET=unit-test-value\n"
            "SITE_DOMAINS=old.example, www.old.example\n"
            "export BLOG_TRUSTED_HOSTS=blog.old.example\n"
        )
        self.env_file = self.deploy / ".env"
        self.env_file.write_text(self.original, encoding="utf-8")
        self.bin = Path(self.temp.name) / "bin"
        self.bin.mkdir()
        self.log = Path(self.temp.name) / "commands.log"
        self.env = os.environ.copy()
        self.env.update(MOCK_LOG=str(self.log), MOCK_FAIL="", MOCK_MARKER=str(self.log) + ".once")
        self.mock("docker", """printf 'docker %s\\n' "$*" >> "$MOCK_LOG"
case "$1" in
  inspect)
    if [[ "$*" == *'{{.Image}}'* ]]; then printf '%s\\n' '""" + OLD_IMAGE + """'; fi
    exit 0 ;;
esac
[[ -z "${SITE_DOMAINS:-}" ]] || exit 91
if [[ "$MOCK_FAIL" == validate && "$*" == *'config --quiet'* ]]; then exit 12; fi
if [[ "$MOCK_FAIL" == caddy && "$*" == *'caddy validate'* ]]; then exit 13; fi
if [[ "$MOCK_FAIL" == build && "$*" == *'build blog'* ]]; then exit 14; fi
if [[ "$MOCK_FAIL" == up && "$*" == *' up '* && ! -f "$MOCK_MARKER" ]]; then
  touch "$MOCK_MARKER"
  exit 15
fi
exit 0
""")
        self.mock("curl", """printf 'curl %s\\n' "$*" >> "$MOCK_LOG"
if [[ "$MOCK_FAIL" == health ]]; then exit 22; fi
printf 200
""")
        # Git Bash lacks util-linux. Linux CI uses the real flock implementation.
        if os.name == "nt":
            self.mock("flock", "exit 0\n")
        bin_path = self.bin.as_posix()
        if os.name == "nt":
            bin_path = "/" + bin_path[0].lower() + bin_path[2:]
        startup = Path(self.temp.name) / "startup.sh"
        startup.write_text('export PATH="' + bin_path + ':$PATH"\n', encoding="utf-8")
        self.env["BASH_ENV"] = str(startup)

    def mock(self, name, body):
        path = self.bin / name
        path.write_text("#!/usr/bin/env bash\nset -eu\n" + body, encoding="utf-8", newline="\n")
        path.chmod(0o755)

    def run_script(self, domains="new.example,old.example", *options):
        return self.run_actions("--domains", domains, *options)

    def run_actions(self, *options):
        return subprocess.run(
            [BASH, str(ROOT / "scripts/update-domains.sh"), "--root", str(self.root), *options],
            env=self.env, text=True, encoding="utf-8", capture_output=True, timeout=30,
        )

    def assert_ok(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_dry_run_is_read_only_and_normalizes_duplicates(self):
        result = self.run_script("NEW.example,old.example,new.example", "--dry-run", "--deploy")
        self.assert_ok(result)
        self.assertIn("BLOG_SITE_URL=https://blog.new.example", result.stdout)
        self.assertIn("SITE_DOMAINS=new.example, www.new.example, old.example, www.old.example\n", result.stdout)
        self.assertEqual(self.env_file.read_text(), self.original)
        self.assertFalse((self.root / "backups").exists())
        self.assertFalse(self.log.exists())
        self.assert_ok(self.run_script())
        self.assertEqual(self.env_file.read_text(), self.original)
        self.assertFalse((self.root / "backups").exists())

    def test_rejects_invalid_input_and_route_collisions(self):
        for value in ("https://new.example", "*.example.com", "new.example:443", "127.0.0.1", "a..example",
                      "a.example,", ",a.example", "a.example,,b.example", "a.example\nevil.example",
                      "a.example;touch nope", "a.example,blog.a.example", "-bad.example", "a-.example",
                      "a" * 64 + ".example"):
            with self.subTest(value=value):
                self.assertNotEqual(self.run_script(value).returncode, 0)
                self.assertEqual(self.env_file.read_text(), self.original)
        self.assertFalse(self.log.exists())

    def test_config_update_preserves_secrets_backups_and_is_idempotent(self):
        result = self.run_script("new.example,old.example", "--deploy")
        self.assert_ok(result)
        updated = self.env_file.read_text()
        self.assertIn("POSTGRES_PASSWORD='fake-$(touch should-not-exist)'\n", updated)
        self.assertIn("BLOG_TRUSTED_HOSTS=blog.new.example,blog.old.example\n", updated)
        self.assertNotIn("export BLOG_TRUSTED_HOSTS", updated)
        self.assertNotIn("unit-test-value", result.stdout + result.stderr)
        self.assertFalse((ROOT / "should-not-exist").exists())
        backups = list((self.root / "backups").glob("domains-*/previous.env"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), self.original)
        if os.name != "nt":
            self.assertEqual(self.env_file.stat().st_mode & 0o777, 0o600)
            self.assertEqual(backups[0].stat().st_mode & 0o777, 0o600)
        self.assert_ok(self.run_script("new.example,old.example", "--deploy"))
        self.assertEqual(self.env_file.read_text(), updated)

    def test_validation_and_build_failure_do_not_touch_live_config(self):
        for failure in ("validate", "caddy", "build"):
            with self.subTest(failure=failure):
                self.env["MOCK_FAIL"] = failure
                self.assertNotEqual(self.run_script("new.example", "--deploy").returncode, 0)
                self.assertEqual(self.env_file.read_text(), self.original)
                self.assertNotIn(" up ", self.log.read_text())

    def test_deploy_checks_origin_and_public_routes_without_dependencies(self):
        self.env["SITE_DOMAINS"] = "stale-shell.example"
        self.assert_ok(self.run_script("new.example", "--deploy"))
        commands = self.log.read_text()
        self.assertLess(commands.index("caddy validate"), commands.index("build blog"))
        self.assertLess(commands.index("build blog"), commands.index(" up "))
        self.assertIn("--no-deps --force-recreate --no-build --pull never --wait", commands)
        self.assertIn("--resolve new.example:443:127.0.0.1", commands)
        self.assertIn("https://www.new.example/health", commands)
        self.assertIn("https://chat.new.example/api/session/me", commands)
        self.assertIn("https://blog.new.example/", commands)
        self.assertEqual(commands.count("curl "), 8)

    def test_failed_restart_or_health_restores_env_and_original_blog_image(self):
        for failure in ("up", "health"):
            with self.subTest(failure=failure):
                self.env["MOCK_FAIL"] = failure
                result = self.run_script("new.example", "--deploy")
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertEqual(self.env_file.read_text(), self.original)
                rollbacks = list((self.root / "backups").glob("domains-*/rollback.yml"))
                self.assertTrue(rollbacks)
                self.assertIn(OLD_IMAGE, rollbacks[-1].read_text())
                self.assertIn("rollback.yml up", self.log.read_text())

    def test_list_and_incremental_preview_leave_files_untouched(self):
        result = self.run_actions("--list")
        self.assert_ok(result)
        self.assertIn("old.example", result.stdout)
        result = self.run_actions("--add", "new.example", "--dry-run")
        self.assert_ok(result)
        self.assertIn("SITE_DOMAINS=old.example, www.old.example, new.example, www.new.example\n", result.stdout)
        self.assertIn("BLOG_SITE_URL=https://blog.old.example", result.stdout)
        self.assertNotIn("unit-test-value", result.stdout)
        self.assertEqual(self.env_file.read_text(), self.original)
        self.assertFalse(self.log.exists())
        self.assertFalse((self.root / "backups").exists())

    def test_add_preserves_existing_and_remove_promotes_remaining_primary(self):
        self.assert_ok(self.run_actions("--add", "NEW.example,second.example", "--deploy"))
        self.assertIn("BLOG_TRUSTED_HOSTS=blog.old.example,blog.new.example,blog.second.example\n", self.env_file.read_text())
        self.assert_ok(self.run_actions("--remove", "old.example", "--deploy"))
        updated = self.env_file.read_text()
        self.assertIn("SITE_DOMAINS=new.example, www.new.example, second.example, www.second.example\n", updated)
        self.assertIn("BLOG_SITE_URL=https://blog.new.example\n", updated)
        self.assertNotIn("old.example", updated)

    def test_combined_add_remove_can_replace_last_domain(self):
        self.assert_ok(self.run_actions("--remove", "old.example", "--add", "new.example", "--deploy"))
        updated = self.env_file.read_text()
        self.assertIn("SITE_DOMAINS=new.example, www.new.example\n", updated)
        self.assertIn("BLOG_SITE_URL=https://blog.new.example\n", updated)

    def test_duplicate_add_and_missing_remove_do_not_restart_services(self):
        self.assert_ok(self.run_actions("--add", "OLD.example,old.example", "--remove", "absent.example", "--deploy"))
        self.assertEqual(self.env_file.read_text(), self.original)
        self.assertFalse(self.log.exists())
        self.assertEqual(list((self.root / "backups").glob("domains-*")), [])

    def test_rejects_empty_result_conflicting_actions_and_invalid_current_config(self):
        for args in (("--remove", "old.example"), ("--add", "x.example", "--remove", "x.example"),
                     ("--domains", "new.example", "--add", "x.example"), ("--list", "--deploy"),
                     ("--remove", "https://old.example"), ("--add", "blog.old.example"), ()):
            with self.subTest(args=args):
                self.assertNotEqual(self.run_actions(*args).returncode, 0)
                self.assertEqual(self.env_file.read_text(), self.original)
        for setting in ("'old.example, www.old.example", "$(touch should-not-exist)", "old.example,www.other.example"):
            self.env_file.write_text("SITE_DOMAINS=" + setting + "\n")
            result = self.run_actions("--add", "new.example")
            self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertFalse(self.log.exists())

    def test_reads_quoted_settings_and_preserves_explicit_primary(self):
        self.env_file.write_text(
            'export SITE_DOMAINS = "first.example, www.first.example, old.example, www.old.example" # routes\n'
            "BLOG_SITE_URL='https://blog.old.example/' # primary\n"
        )
        result = self.run_actions("--add", "new.example")
        self.assert_ok(result)
        self.assertIn("SITE_DOMAINS=old.example, www.old.example, first.example, www.first.example, new.example, www.new.example\n", result.stdout)
        result = self.run_actions("--remove", "old.example")
        self.assert_ok(result)
        self.assertIn("BLOG_SITE_URL=https://blog.first.example", result.stdout)

    def test_unset_domains_use_caddy_defaults(self):
        self.env_file.write_text("SITE_DOMAINS=\nBLOG_SITE_URL=\n")
        result = self.run_actions("--add", "new.example")
        self.assert_ok(result)
        self.assertIn("SITE_DOMAINS=zstuacm.xyz, www.zstuacm.xyz, zstu.asia, www.zstu.asia, new.example, www.new.example\n", result.stdout)
        self.assertIn("BLOG_SITE_URL=https://blog.zstuacm.xyz", result.stdout)

    def test_incremental_failure_restores_previous_domain_configuration(self):
        self.env["MOCK_FAIL"] = "health"
        self.assertNotEqual(self.run_actions("--add", "new.example", "--deploy").returncode, 0)
        self.assertEqual(self.env_file.read_text(), self.original)
        self.assertIn("rollback.yml up", self.log.read_text())


if __name__ == "__main__":
    unittest.main()
