import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const entryCount = manifest.pi.extensions.length;

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

test("native Pi discovers every declared entry without registering personal models", async (t) => {
  const { result } = await load(t);
  assertClean(result);
  assert.equal(result.extensions.length, entryCount);
  assert.deepEqual(commands(result).sort(), ["block-editor", "clear", "hud", "pm"]);
  assert.equal(new Set(result.extensions.map((e) => e.resolvedPath)).size, entryCount);
  assert.equal(result.runtime.pendingProviderRegistrations.length, 0);
  assert.equal(result.extensions.flatMap((e) => [...e.flags.keys()]).length, 3);
  for (const extension of result.extensions) assert.equal(extension.tools.size, 0);
});

test("native package filtering can disable a single upstream module", async (t) => {
  const { result } = await load(t, { packages: [{ source: root, extensions: ["!node_modules/pi-hud/**"] }] });
  assertClean(result);
  assert.equal(result.extensions.length, entryCount - 1);
  assert.ok(!commands(result).includes("hud"));
  assert.ok(commands(result).includes("block-editor"));
});

test("the editor adapter remains an independently filterable resource", async (t) => {
  const { result } = await load(t, { packages: [{ source: root, extensions: ["!extensions/block-editor.ts"] }] });
  assertClean(result);
  assert.equal(result.extensions.length, entryCount - 1);
  assert.ok(!commands(result).includes("block-editor"));
  assert.ok(commands(result).includes("hud"));
  assert.ok(commands(result).includes("clear"));
});

test("reload does not multiply commands or hooks", async (t) => {
  const { result, loader } = await load(t);
  assertClean(result);
  const before = result.extensions.map((e) => [e.path, [...e.handlers].map(([name, handlers]) => [name, handlers.length])]);
  await loader.reload();
  const after = loader.getExtensions();
  assertClean(after);
  assert.equal(after.extensions.length, entryCount);
  assert.deepEqual(commands(after).sort(), commands(result).sort());
  assert.deepEqual(after.extensions.map((e) => [e.path, [...e.handlers].map(([name, handlers]) => [name, handlers.length])]), before);
});

const policyModule = (result) => result.extensions.find((extension) => extension.path.endsWith("/pi-gpt-subagent-policy/src/index.ts"));
const policySection = "gpt_subagent_policy";

test("GPT policy is one independently filterable module with no tools, commands or flags", async (t) => {
  const only = await load(t, { packages: [{ source: root, extensions: ["node_modules/pi-gpt-subagent-policy/src/index.ts"] }] });
  assertClean(only.result);
  assert.equal(only.result.extensions.length, 1);
  const policy = policyModule(only.result);
  assert.equal(policy.handlers.get("before_agent_start").length, 1);
  assert.equal(policy.tools.size + policy.commands.size + policy.flags.size, 0);
});

test("GPT policy can be excluded while the other modules remain loaded", async (t) => {
  const excluded = await load(t, { packages: [{ source: root, extensions: ["!node_modules/pi-gpt-subagent-policy/**"] }] });
  assertClean(excluded.result);
  assert.equal(excluded.result.extensions.length, entryCount - 1);
  assert.equal(policyModule(excluded.result), undefined);
});

test("bundled policy keeps GPT -> non-GPT -> Terra conditional prompting and unrelated sections", async (t) => {
  const { result } = await load(t);
  assertClean(result);
  const policy = policyModule(result);
  assert.equal(result.extensions.filter((extension) => extension === policy).length, 1);
  const handler = policy.handlers.get("before_agent_start")[0];
  const options = { sections: { unrelated: "keep this" }, customPrompt: "unchanged custom prompt" };
  const event = { systemPromptOptions: options };
  const invoke = (model) => handler(event, { model, mode: "print", hasUI: false,
    get modelRegistry() { throw new Error("Policy must not access a model backend"); } });
  await invoke({ provider: "openai", id: "gpt-6.1-sol" });
  const expected = readFileSync(join(root, "node_modules/pi-gpt-subagent-policy/gpt-subagent-policy.md"), "utf8").trim();
  assert.equal(options.sections[policySection], expected);
  await invoke({ provider: "openai", id: "gpt-6.1-sol" });
  assert.deepEqual(Object.keys(options.sections).sort(), [policySection, "unrelated"]);
  await invoke({ provider: "openai", id: "glm-5.3", name: "GPT display name", api: "openai-completions" });
  assert.deepEqual(options.sections, { unrelated: "keep this" });
  await invoke({ provider: "gateway", id: "gpt-6.1-terra" });
  assert.equal(options.sections[policySection], expected);
  assert.equal(options.customPrompt, "unchanged custom prompt");
});

test("bundled policy honors live agent-dir switches, invalid-config fail-closed and exact patterns", async (t) => {
  const { result, agentDir } = await load(t);
  assertClean(result);
  const handler = policyModule(result).handlers.get("before_agent_start")[0];
  const path = join(agentDir, "pi-gpt-subagent-policy.json");
  const options = { sections: { unrelated: "keep" } };
  const event = { systemPromptOptions: options };
  const warnings = [];
  const ctx = { model: { provider: "gateway", id: "gpt-6.1-sol" }, mode: "rpc", hasUI: true,
    ui: { notify: (message) => warnings.push(message) } };
  await handler(event, ctx);
  assert.ok(options.sections[policySection]);
  writeFileSync(path, JSON.stringify({ enabled: false }));
  await handler(event, ctx);
  assert.deepEqual(options.sections, { unrelated: "keep" });
  writeFileSync(path, "{");
  await handler(event, ctx); await handler(event, ctx);
  assert.equal(warnings.length, 1);
  assert.deepEqual(options.sections, { unrelated: "keep" });
  writeFileSync(path, JSON.stringify({ enabled: true, modelPatterns: ["openai/gpt-6.1-sol"] }));
  await handler(event, ctx);
  assert.equal(options.sections[policySection], undefined);
  ctx.model = { provider: "openai", id: "gpt-6.1-sol" };
  await handler(event, ctx);
  assert.ok(options.sections[policySection]);
});

test("bundled policy cleans only its inherited tag from a forced non-GPT prompt", async (t) => {
  const { result } = await load(t);
  assertClean(result);
  const handler = policyModule(result).handlers.get("before_agent_start")[0];
  const options = { sections: { unrelated: "keep" }, forceSystemPrompt: "base\n<gpt_subagent_policy>\nstale\n</gpt_subagent_policy>\n<other>keep</other>" };
  const event = { systemPromptOptions: options };
  await handler(event, { model: { provider: "openai", id: "gpt-6.1-sol" }, mode: "print", hasUI: false });
  assert.equal(options.forceSystemPrompt.match(/<gpt_subagent_policy>/g)?.length, 1);
  await handler(event, { model: { provider: "openai", id: "glm-5.3" }, mode: "print", hasUI: false });
  assert.ok(!options.forceSystemPrompt.includes("gpt_subagent_policy"));
  assert.ok(options.forceSystemPrompt.includes("<other>keep</other>"));
  assert.deepEqual(options.sections, { unrelated: "keep" });
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

for (const source of ["local", "git"]) test(`workbench ${source} startup is one summary with all native detail paths`, async (t) => {
  const { result, cwd } = await load(t);
  assertClean(result);
  const entries = manifest.pi.extensions.map((path) => path.replace(/^\.\//, ""));
  const labels = source === "git" ? entries.map((path) => `M1racleShih/pi-my-workbench:${path}`)
    : entries.map((path) => basename(path.replace(/\/index\.ts$/, "")));
  const paths = entries.map((path) => source === "git" ? path : `${root}/${path.replace(/\/index\.ts$/, "")}`);
  const expanded = source === "git" ? `[Extensions]\n  user\n    git:github.com/M1racleShih/pi-my-workbench@main\n${paths.map((path) => `      ${path}`).join("\n")}`
    : `[Extensions]\n  user\n${paths.map((path) => `    ${path}`).join("\n")}`;
  const section = {
    state: { expanded: false },
    build() { return this.state.expanded ? expanded : `[Extensions]\n  ${labels.join(", ")}`; },
    render() { return this.build().split("\n"); },
    invalidate() {},
    setExpanded(value) { this.state.expanded = value; },
  };
  const original = section.render;
  const tui = { children: [section], terminal: { rows: 60 }, requestRender() {} };
  let header, editor;
  const ctx = { mode: "tui", hasUI: true, cwd, sessionManager: { getBranch: () => [] }, getSystemPrompt: () => "test",
    ui: { theme: { fg: (_color, text) => text, bold: (text) => text }, notify() {}, getToolsExpanded: () => false,
      getEditorComponent: () => editor, setEditorComponent: (factory) => { editor = factory; },
      setHeader: (factory) => { header = factory(tui); } } };
  const extension = result.extensions.find((e) => e.commands.has("block-editor"));
  for (const handler of extension.handlers.get("session_start")) await handler({ reason: "startup" }, ctx);
  header.render(120);
  const collapsed = section.render(120).join("\n");
  assert.ok(collapsed.includes("Extensions · 1"), collapsed);
  assert.equal(collapsed.match(/pi-my-workbench/g)?.length, 1);
  assert.ok(!collapsed.includes("clear.ts"));
  section.setExpanded(true);
  assert.equal(section.render(200).join("\n"), expanded);
  section.setExpanded(false);
  assert.ok(section.render(120).join("\n").includes("Extensions · 1"));
  for (const handler of extension.handlers.get("session_shutdown")) await handler({ reason: "quit" }, ctx);
  assert.equal(section.render, original);
});

test("manifest intentionally has no global default model changes or extra resource types", () => {
  assert.equal(manifest.pi.extensions.length, 7);
  assert.equal(manifest.engines.node, ">=24");
  assert.deepEqual(manifest.pi.skills, []);
  assert.deepEqual(manifest.pi.prompts, []);
  assert.deepEqual(manifest.pi.themes, []);
});
