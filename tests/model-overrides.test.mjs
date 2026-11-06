import assert from "node:assert/strict";
import test from "node:test";
import { parseModelOverrides } from "../lib/model-overrides.mjs";

const never = () => { throw new Error("unexpected lookup"); };

test("model overrides are off unless explicitly enabled", () => {
  assert.deepEqual(parseModelOverrides({}, never), []);
  assert.deepEqual(parseModelOverrides({ enabled: false, providers: {} }, never), []);
});

test("resolves builtin metadata, preserves custom models and an empty catalogue", () => {
  const builtin = { id: "model", name: "Original", cost: { input: 1 } };
  const custom = { id: "custom", api: "openai-completions", compat: { thinkingFormat: "deepseek" } };
  const input = { enabled: true, providers: { original: { models: [{ builtin: "vendor/model" }, custom] }, empty: { models: [] } } };
  const original = structuredClone(input);
  const result = parseModelOverrides(input, (provider, id) => {
    assert.equal(provider, "vendor"); assert.equal(id, "model"); return builtin;
  });
  assert.deepEqual(result, [["original", { models: [builtin, custom] }], ["empty", { models: [] }]]);
  assert.deepEqual(input, original);
});

test("rejects malformed documents and unsupported provider-level settings", () => {
  for (const document of [null, [], { enabled: "true" }, { enabled: true }, { enabled: true, providers: [] },
    { enabled: true, providers: { a: { models: [], apiKey: "not-supported" } } },
    { enabled: true, providers: { a: { models: [{ builtin: "bad" }] } } },
    { enabled: true, providers: { a: { models: [{ id: "same" }, { id: "same" }] } } },
    { enabled: true, providers: { a: { models: [{}] } } },
    JSON.parse('{"enabled":true,"providers":{"__proto__":{"models":[]}}}'),
    { enabled: true, providers: {}, unexpected: true }]) {
    assert.throws(() => parseModelOverrides(document, () => undefined), /model-overrides:/);
  }
});

test("does not return a partial registration list when a later reference fails", () => {
  assert.throws(() => parseModelOverrides({ enabled: true, providers: {
    good: { models: [{ id: "a" }] }, bad: { models: [{ builtin: "vendor/missing" }] },
  } }, () => undefined), /not found/);
});
