import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkRelease(root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const json = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
  const manifest = json("package.json");
  const upstreams = json("upstreams.json");
  const lock = json("package-lock.json");
  const state = existsSync(join(root, ".workbench/overrides.json")) ? json(".workbench/overrides.json") : {};
  assert.equal(Object.keys(state).length, 0, "Reset development overrides before packaging or release verification");
  assert.equal(manifest.name, "pi-my-workbench");
  assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies, "Lockfile differs from dependencies");
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), Object.keys(upstreams).sort());
  assert.deepEqual([...manifest.bundledDependencies].sort(), Object.keys(upstreams).sort());
  for (const [name, spec] of Object.entries(upstreams)) {
    const expected = spec.commit ? `${spec.repository.replace("https://github.com/", "https://codeload.github.com/")}/tar.gz/${spec.commit}` : spec.version;
    if (spec.commit) assert.match(spec.commit, /^[a-f0-9]{40}$/);
    assert.equal(manifest.dependencies[name], expected, `Unpinned or mismatched source for ${name}`);
    const locked = lock.packages[`node_modules/${name}`];
    assert.match(locked.integrity, /^sha512-/);
    assert.ok(locked.resolved.startsWith("https://"), `Release dependency must not require SSH: ${name}`);
    if (spec.commit) assert.equal(locked.resolved, expected);
    const dependency = join(root, "node_modules", name);
    assert.ok(!lstatSync(dependency).isSymbolicLink(), `Refusing to package development link: ${name}`);
    const installed = json(`node_modules/${name}/package.json`);
    assert.equal(installed.name, name);
    assert.equal(installed.version, spec.version, `Version mismatch for ${name}`);
    assert.ok(existsSync(join(dependency, spec.entry)), `Missing upstream entry for ${name}`);
    assert.ok(manifest.pi.extensions.includes(`./${spec.resource ?? `node_modules/${name}/${spec.entry}`}`));
  }
  for (const entry of manifest.pi.extensions) assert.ok(existsSync(join(root, entry)), `Missing extension entry: ${entry}`);
  assert.ok(!Object.keys(manifest.dependencies).some((name) => name.startsWith("@earendil-works/") || name === "typebox"));
  return manifest.pi.extensions.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.error(`Release checks passed: ${checkRelease()} independent extension entries`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
