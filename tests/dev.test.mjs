import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { development } from "../scripts/dev.mjs";
import { checkRelease } from "../scripts/release-check.mjs";

function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), "pi-workbench-dev-test-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, "workbench");
  const source = join(temp, "source");
  const dependency = join(root, "node_modules/pi-hud");
  for (const path of [root, source, dependency]) mkdirSync(path, { recursive: true });
  writeFileSync(join(root, "upstreams.json"), JSON.stringify({ "pi-hud": { alias: "hud", entry: "index.ts" } }));
  for (const path of [source, dependency]) {
    writeFileSync(join(path, "package.json"), JSON.stringify({ name: "pi-hud" }));
    writeFileSync(join(path, "index.ts"), path === source ? "local source" : "pinned source");
  }
  return { root, source, dependency, dev: development(root) };
}

test("development link is idempotent, reversible and never writes the upstream", (t) => {
  const { root, source, dependency, dev } = fixture(t);
  dev.use("hud", source); dev.use("hud", source);
  assert.equal(realpathSync(dependency), source);
  assert.deepEqual(dev.status(), { "pi-hud": source });
  assert.equal(readFileSync(join(root, ".workbench/pinned/pi-hud/index.ts"), "utf8"), "pinned source");
  dev.reset("hud"); dev.reset("hud");
  assert.equal(lstatSync(dependency).isSymbolicLink(), false);
  assert.deepEqual(dev.status(), {});
  assert.equal(readFileSync(join(dependency, "index.ts"), "utf8"), "pinned source");
  assert.equal(readFileSync(join(source, "index.ts"), "utf8"), "local source");
});

test("can reset a managed link even when its source was removed", (t) => {
  const { source, dependency, dev } = fixture(t);
  dev.use("hud", source);
  rmSync(source, { recursive: true });
  dev.reset("hud");
  assert.equal(readFileSync(join(dependency, "index.ts"), "utf8"), "pinned source");
  assert.deepEqual(dev.status(), {});
});

test("switching local sources preserves the original pinned backup", (t) => {
  const { source, dependency, dev } = fixture(t);
  const second = `${source}-second`;
  mkdirSync(second);
  t.after(() => rmSync(second, { recursive: true, force: true }));
  writeFileSync(join(second, "package.json"), '{"name":"pi-hud"}');
  writeFileSync(join(second, "index.ts"), "second source");
  dev.use("hud", source); dev.use("hud", second);
  assert.equal(realpathSync(dependency), second);
  dev.reset("hud");
  assert.equal(readFileSync(join(dependency, "index.ts"), "utf8"), "pinned source");
  assert.equal(readFileSync(join(source, "index.ts"), "utf8"), "local source");
});

test("rejects wrong packages, internal sources and unmanaged links", (t) => {
  const { source, dependency, dev } = fixture(t);
  assert.throws(() => dev.use("unknown", source), /Unknown module/);
  assert.throws(() => dev.use("hud", dependency), /outside/);
  writeFileSync(join(source, "package.json"), '{"name":"wrong"}');
  assert.throws(() => dev.use("hud", source), /does not match/);
  assert.equal(lstatSync(dependency).isDirectory(), true);
  rmSync(dependency, { recursive: true });
  symlinkSync(source, dependency, "dir");
  writeFileSync(join(source, "package.json"), '{"name":"pi-hud"}');
  assert.throws(() => dev.use("hud", source), /unmanaged/);
  assert.ok(existsSync(join(source, "index.ts")));
});

test("refuses symlinked management directories", (t) => {
  const { root, source, dev } = fixture(t);
  symlinkSync(source, join(root, ".workbench"), "dir");
  assert.throws(() => dev.use("hud", source), /ordinary directories/);
});

test("packaging rejects active development state before reading dependency contents", (t) => {
  const { root, source, dev } = fixture(t);
  writeFileSync(join(root, "package.json"), '{}');
  writeFileSync(join(root, "package-lock.json"), '{}');
  dev.use("hud", source);
  assert.throws(() => checkRelease(root), /Reset development overrides/);
});
