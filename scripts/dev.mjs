import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const present = (path) => { try { lstatSync(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
const inside = (parent, child) => { const rel = relative(parent, child); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); };

export function development(workspace = root) {
  workspace = realpathSync(workspace);
  const upstreams = readJson(join(workspace, "upstreams.json"));
  const local = join(workspace, ".workbench");
  const statePath = join(local, "overrides.json");
  const state = () => existsSync(statePath) ? readJson(statePath) : {};
  const save = (value) => {
    mkdirSync(local, { recursive: true, mode: 0o700 });
    const temp = `${statePath}.tmp`;
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, statePath);
  };
  const identify = (alias) => {
    const entry = Object.entries(upstreams).find(([name, spec]) => alias === name || alias === spec.alias);
    if (!entry) throw new Error(`Unknown module; use ${Object.values(upstreams).map((spec) => spec.alias).join(", ")}`);
    const [name, spec] = entry;
    const dependency = join(workspace, "node_modules", name);
    const backup = join(local, "pinned", name);
    return { name, spec, dependency, backup };
  };
  const assertLocalStorage = () => {
    for (const path of [join(workspace, "node_modules"), local, join(local, "pinned")]) {
      if (present(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())) {
        throw new Error("Development storage must be ordinary directories within this checkout");
      }
    }
  };
  return {
    status: state,
    use(alias, source) {
      const { name, spec, dependency, backup } = identify(alias);
      assertLocalStorage();
      const target = realpathSync(resolve(source));
      if (inside(workspace, target)) throw new Error("Development source must be outside the workbench checkout");
      if (readJson(join(target, "package.json")).name !== name || !existsSync(join(target, spec.entry))) {
        throw new Error("Development source does not match the module name and entry point");
      }
      const current = state();
      const previous = current[name];
      if (present(dependency) && lstatSync(dependency).isSymbolicLink()) {
        if (!current[name] || resolve(dirname(dependency), readlinkSync(dependency)) !== current[name]) throw new Error("Refusing to replace an unmanaged dependency link");
        if (current[name] === target) return;
        if (!present(backup) || lstatSync(backup).isSymbolicLink()) throw new Error("Pinned dependency backup is missing or unsafe");
        unlinkSync(dependency);
        try { symlinkSync(target, dependency, "dir"); }
        catch (error) { symlinkSync(current[name], dependency, "dir"); throw error; }
      } else {
        if (current[name] || present(backup)) throw new Error("Stale development state; reset links before running npm ci or updating dependencies");
        if (!present(dependency) || !lstatSync(dependency).isDirectory()) throw new Error("Install pinned dependencies first with npm ci");
        mkdirSync(dirname(backup), { recursive: true, mode: 0o700 });
        renameSync(dependency, backup);
        try { symlinkSync(target, dependency, "dir"); }
        catch (error) { renameSync(backup, dependency); throw error; }
      }
      current[name] = target;
      try { save(current); }
      catch (error) {
        unlinkSync(dependency);
        if (previous) symlinkSync(previous, dependency, "dir");
        else renameSync(backup, dependency);
        throw error;
      }
    },
    reset(alias) {
      const { name, dependency, backup } = identify(alias);
      assertLocalStorage();
      const current = state();
      if (!current[name]) return;
      if (!present(dependency) || !lstatSync(dependency).isSymbolicLink() || resolve(dirname(dependency), readlinkSync(dependency)) !== current[name] ||
          !present(backup) || !lstatSync(backup).isDirectory() || lstatSync(backup).isSymbolicLink()) {
        throw new Error("Development link changed outside this tool; refusing to touch it");
      }
      const previous = current[name];
      unlinkSync(dependency);
      renameSync(backup, dependency);
      delete current[name];
      try { save(current); }
      catch (error) {
        renameSync(dependency, backup);
        symlinkSync(previous, dependency, "dir");
        throw error;
      }
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, alias, source, ...extra] = process.argv.slice(2);
    const dev = development();
    if (action === "status" && !alias) console.log(JSON.stringify(dev.status(), null, 2));
    else if (action === "use" && alias && source && extra.length === 0) dev.use(alias, source);
    else if (action === "reset" && alias && !source) dev.reset(alias);
    else throw new Error("Usage: npm run dev -- status | use <module> <path> | reset <module>");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
