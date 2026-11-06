import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

async function load(t, options = {}) {
  const temp = mkdtempSync(join(tmpdir(), "pi-workbench-loader-test-"));
  const agentDir = join(temp, "agent");
  const cwd = join(temp, "workspace");
  mkdirSync(agentDir); mkdirSync(cwd);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(temp, { recursive: true, force: true });
  });
  if (options.models) writeFileSync(join(agentDir, "pi-my-workbench-models.json"), JSON.stringify(options.models));
  const loader = new DefaultResourceLoader({
    cwd, agentDir,
    settingsManager: SettingsManager.inMemory({ packages: options.packages ?? [root], skills: [] }),
    disabledBuiltinExtensions: ["mcp", "llama.cpp", "codemode", "tool-search"],
    noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
  });
  await loader.reload();
  return { loader, result: loader.getExtensions(), agentDir, cwd };
}

function assertClean(result) {
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings ?? [], []);
}
const commands = (result) => result.extensions.flatMap((extension) => [...extension.commands.keys()]);

test("native Pi discovers six independent entries without registering personal models", async (t) => {
  const { result } = await load(t);
  assertClean(result);
  assert.equal(result.extensions.length, 6);
  assert.deepEqual(commands(result).sort(), ["block-editor", "clear", "hud", "pm"]);
  assert.equal(new Set(result.extensions.map((e) => e.resolvedPath)).size, 6);
  assert.equal(result.runtime.pendingProviderRegistrations.length, 0);
  assert.equal(result.extensions.flatMap((e) => [...e.flags.keys()]).length, 3);
  for (const extension of result.extensions) assert.equal(extension.tools.size, 0);
});

test("native package filtering can disable a single upstream module", async (t) => {
  const { result } = await load(t, { packages: [{ source: root, extensions: ["!node_modules/pi-hud/**"] }] });
  assertClean(result);
  assert.equal(result.extensions.length, 5);
  assert.ok(!commands(result).includes("hud"));
  assert.ok(commands(result).includes("block-editor"));
});

test("reload does not multiply commands or hooks", async (t) => {
  const { result, loader } = await load(t);
  assertClean(result);
  const before = result.extensions.map((e) => [e.path, [...e.handlers].map(([name, handlers]) => [name, handlers.length])]);
  await loader.reload();
  const after = loader.getExtensions();
  assertClean(after);
  assert.equal(after.extensions.length, 6);
  assert.deepEqual(commands(after).sort(), commands(result).sort());
  assert.deepEqual(after.extensions.map((e) => [e.path, [...e.handlers].map(([name, handlers]) => [name, handlers.length])]), before);
});

test("model overrides queue exactly the opted-in definitions", async (t) => {
  const model = { id: "test-model", name: "Test model", api: "openai-completions", baseUrl: "https://example.invalid/v1",
    reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 256 };
  const { result } = await load(t, { models: { enabled: true, providers: { "test-provider": { models: [model] }, empty: { models: [] } } } });
  assertClean(result);
  assert.deepEqual(result.runtime.pendingProviderRegistrations.map(({ name, config }) => [name, config]),
    [["test-provider", { models: [model] }], ["empty", { models: [] }]]);
});

test("invalid model configuration registers no partial provider list", async (t) => {
  const { result } = await load(t, { models: { enabled: true, providers: {
    good: { models: [{ id: "test" }] }, bad: { models: [{ builtin: "not-a-provider/missing" }] },
  } } });
  assert.equal(result.errors.length, 1);
  assert.equal(result.runtime.pendingProviderRegistrations.length, 0);
  assert.ok(commands(result).includes("clear"));
});

test("upstream TUI modules do not install surfaces in headless lifecycle events", async (t) => {
  const { result, cwd } = await load(t);
  assertClean(result);
  const ctx = { mode: "json", hasUI: false, cwd, ui: new Proxy({}, { get() { throw new Error("headless UI access"); } }) };
  for (const extension of result.extensions) {
    if (extension.path.endsWith("/clear.ts")) continue;
    for (const handler of extension.handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
    for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler({ reason: "quit" }, ctx);
  }
});

test("clear preserves model and thinking across a replacement factory", async (t) => {
  const { result, loader } = await load(t);
  assertClean(result);
  const command = result.extensions.find((e) => e.commands.has("clear")).commands.get("clear");
  const originalModel = { provider: "example", id: "chosen" };
  result.runtime.getThinkingLevel = () => "high";
  const notices = [];
  let restoredModel;
  let restoredThinking;
  await command.handler("", {
    model: originalModel, ui: { notify: (text) => notices.push(text) },
    newSession: async ({ withSession }) => {
      await loader.reload();
      const replacement = loader.getExtensions();
      replacement.runtime.getThinkingLevel = () => "medium";
      replacement.runtime.setModel = async (model) => { restoredModel = model; return true; };
      replacement.runtime.setThinkingLevel = (level) => { restoredThinking = level; };
      const clear = replacement.extensions.find((e) => e.commands.has("clear"));
      for (const handler of clear.handlers.get("session_start")) await handler({ reason: "new" }, {
        model: { provider: "example", id: "default" },
        modelRegistry: { find: () => originalModel }, ui: { notify: (text) => notices.push(text) },
      });
      await withSession({ ui: { notify: (text) => notices.push(text) } });
      return { cancelled: false };
    },
  });
  assert.equal(restoredModel, originalModel);
  assert.equal(restoredThinking, "high");
  assert.equal(notices.length, 1);
});

test("manifest intentionally has no global default model changes or extra resource types", () => {
  assert.equal(manifest.pi.extensions.length, 6);
  assert.deepEqual(manifest.pi.skills, []);
  assert.deepEqual(manifest.pi.prompts, []);
  assert.deepEqual(manifest.pi.themes, []);
});
