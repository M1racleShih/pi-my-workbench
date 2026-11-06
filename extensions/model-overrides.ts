import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { getAgentDir, type ExtensionAPI, type ProviderConfig } from "@earendil-works/pi-coding-agent";
import { parseModelOverrides } from "../lib/model-overrides.mjs";

/** No model selection or endpoint is shipped. The active agent directory owns this opt-in document. */
export default function modelOverrides(pi: ExtensionAPI): void {
  const path = join(getAgentDir(), "pi-my-workbench-models.json");
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error("pi-my-workbench: cannot read model-overrides configuration");
  }
  let document: unknown;
  try { document = JSON.parse(source); }
  catch { throw new Error("pi-my-workbench: model-overrides configuration is not valid JSON"); }
  const overrides = parseModelOverrides(document, (provider: string, id: string) => getBuiltinModel(provider, id));
  for (const [provider, config] of overrides) pi.registerProvider(provider, config as ProviderConfig);
}
