const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Resolve the complete document before the caller registers any provider. */
export function parseModelOverrides(document, lookupBuiltin) {
  if (!record(document)) throw new Error("model-overrides: expected an object");
  for (const key of Object.keys(document)) {
    if (!["enabled", "providers"].includes(key)) throw new Error("model-overrides: unknown top-level field");
  }
  if (document.enabled !== undefined && typeof document.enabled !== "boolean") {
    throw new Error("model-overrides: enabled must be boolean");
  }
  if (document.enabled !== true) return [];
  if (!record(document.providers)) throw new Error("model-overrides: providers must be an object");

  return Object.entries(document.providers).map(([provider, config]) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(provider) || ["__proto__", "constructor", "prototype"].includes(provider)) {
      throw new Error("model-overrides: invalid provider name");
    }
    if (!record(config) || Object.keys(config).some((key) => key !== "models") || !Array.isArray(config.models)) {
      throw new Error(`model-overrides: ${provider} must contain only a models array`);
    }
    const seen = new Set();
    const models = config.models.map((definition) => {
      if (!record(definition)) throw new Error(`model-overrides: invalid model in ${provider}`);
      let model = definition;
      if (Object.hasOwn(definition, "builtin")) {
        if (Object.keys(definition).length !== 1 || typeof definition.builtin !== "string") {
          throw new Error(`model-overrides: invalid builtin reference in ${provider}`);
        }
        const slash = definition.builtin.indexOf("/");
        if (slash < 1 || slash === definition.builtin.length - 1) {
          throw new Error(`model-overrides: builtin must be provider/model-id in ${provider}`);
        }
        model = lookupBuiltin(definition.builtin.slice(0, slash), definition.builtin.slice(slash + 1));
        if (!model) throw new Error(`model-overrides: builtin model not found in ${provider}`);
      }
      if (typeof model.id !== "string" || !model.id.trim()) throw new Error(`model-overrides: model id missing in ${provider}`);
      if (seen.has(model.id)) throw new Error(`model-overrides: duplicate model id in ${provider}`);
      seen.add(model.id);
      return model;
    });
    return [provider, { models }];
  });
}
