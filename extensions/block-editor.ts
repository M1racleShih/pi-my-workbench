import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import blockEditor from "pi-block-editor/index.ts";

/** One-module adapter: declare presentation ownership, never aggregate factories. */
export default function workbenchEditor(pi: ExtensionAPI): void {
  blockEditor(pi, {
    extensionGroups: [{
      label: "pi-my-workbench",
      root: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
      packageLabels: ["M1racleShih/pi-my-workbench", "pi-my-workbench"],
    }],
  });
}
