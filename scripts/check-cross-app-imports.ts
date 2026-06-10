import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

// Apps integrate through HTTP APIs, `packages/contracts`, and app-local
// provider boundaries. Reaching into another app's directory (src/, tests/,
// or even dist/) couples two runtimes through private implementation and is
// a repository boundary violation; `apps/web/**` importing
// `apps/daemon/src/**` is the canonical example.
const crossAppImportSkippedDirectories = new Set([
  ".next",
  ".od-data",
  "dist",
  "node_modules",
  "out",
  "reports",
  "test-results",
]);

const crossAppImportSourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);

export type AppDirectoryRegistry = {
  // app directory name under apps/ (e.g. "daemon") -> package name (e.g. "@open-design/daemon")
  packageNameByDirectory: Map<string, string>;
};

export type CrossAppImportViolation = {
  filePath: string;
  lineNumber: number;
  specifier: string;
  targetApp: string;
  reason: string;
};

type CrossAppImportAllowlistEntry = {
  pathPattern: RegExp;
  specifierPattern: RegExp;
  reason: string;
};

// Only deliberate, documented exceptions belong here. Prefer promoting the
// shared logic to packages/ instead.
const crossAppImportAllowlist: CrossAppImportAllowlistEntry[] = [
  {
    pathPattern: /^apps\/packaged\/(?:src|tests)\//,
    specifierPattern: /^@open-design\/desktop\/main$/,
    reason:
      "apps/packaged is the thin packaged Electron entry that wraps the desktop shell through its declared ./main package export",
  },
];

const importSpecifierPatterns = [
  // import defaultExport, { named as alias } from '...' / import type { T } from '...'
  /\bimport\s+(?:type\s+)?[\w$*{},\s]*?\bfrom\s*['"]([^'"\n]+)['"]/g,
  // side-effect import '...' (not CSS @import, which can appear in fixture strings)
  /(?<!@)\bimport\s*['"]([^'"\n]+)['"]/g,
  // export { x } from '...' / export * from '...' / export type { T } from '...'
  /\bexport\s+(?:type\s+)?[\w$*{},\s]*?\bfrom\s*['"]([^'"\n]+)['"]/g,
  // dynamic import('...')
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  // require('...')
  /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

function lineNumberForIndex(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function appDirectoryForRepositoryPath(repositoryPath: string): string | null {
  const [scope, appDirectory] = repositoryPath.split("/");
  return scope === "apps" && appDirectory ? appDirectory : null;
}

function isCrossAppImportAllowlisted(repositoryPath: string, specifier: string): boolean {
  return crossAppImportAllowlist.some(
    (entry) => entry.pathPattern.test(repositoryPath) && entry.specifierPattern.test(specifier),
  );
}

function targetAppForSpecifier(
  repositoryPath: string,
  specifier: string,
  registry: AppDirectoryRegistry,
): string | null {
  const importingApp = appDirectoryForRepositoryPath(repositoryPath);
  if (importingApp == null) return null;

  const isForeignAppDirectory = (targetApp: string | null): targetApp is string =>
    targetApp != null && targetApp !== importingApp && registry.packageNameByDirectory.has(targetApp);

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(repositoryPath), specifier));
    const targetApp = appDirectoryForRepositoryPath(resolved);
    return isForeignAppDirectory(targetApp) ? targetApp : null;
  }

  if (specifier.startsWith("apps/")) {
    const targetApp = appDirectoryForRepositoryPath(specifier);
    return isForeignAppDirectory(targetApp) ? targetApp : null;
  }

  for (const [appDirectory, packageName] of registry.packageNameByDirectory) {
    if (appDirectory === importingApp) continue;
    if (specifier === packageName || specifier.startsWith(`${packageName}/`)) {
      return appDirectory;
    }
  }

  return null;
}

export function collectCrossAppImportViolationsFromSource(
  repositoryPath: string,
  source: string,
  registry: AppDirectoryRegistry,
): CrossAppImportViolation[] {
  const violations: CrossAppImportViolation[] = [];
  const seen = new Set<string>();

  for (const pattern of importSpecifierPatterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier === undefined) continue;

      const dedupeKey = `${match.index}\0${specifier}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const targetApp = targetAppForSpecifier(repositoryPath, specifier, registry);
      if (targetApp == null || isCrossAppImportAllowlisted(repositoryPath, specifier)) continue;

      violations.push({
        filePath: repositoryPath,
        lineNumber: lineNumberForIndex(source, match.index ?? 0),
        specifier,
        targetApp,
        reason: `apps must not import another app's private implementation (apps/${targetApp}); integrate via HTTP APIs and packages/contracts`,
      });
    }
  }

  return violations.sort((left, right) => left.lineNumber - right.lineNumber);
}

async function loadAppDirectoryRegistry(): Promise<AppDirectoryRegistry> {
  const appsRoot = path.join(repoRoot, "apps");
  const packageNameByDirectory = new Map<string, string>();

  for (const entry of await readdir(appsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const manifestPath = path.join(appsRoot, entry.name, "package.json");
    let manifest: { name?: unknown };
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { name?: unknown };
    } catch {
      continue;
    }

    if (typeof manifest.name === "string" && manifest.name.length > 0) {
      packageNameByDirectory.set(entry.name, manifest.name);
    }
  }

  return { packageNameByDirectory };
}

async function collectAppSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (crossAppImportSkippedDirectories.has(entry.name)) continue;
      files.push(...(await collectAppSourceFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && crossAppImportSourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function checkCrossAppImports(): Promise<boolean> {
  const registry = await loadAppDirectoryRegistry();
  const violations: CrossAppImportViolation[] = [];

  for (const appDirectory of [...registry.packageNameByDirectory.keys()].sort()) {
    for (const fullPath of await collectAppSourceFiles(path.join(repoRoot, "apps", appDirectory))) {
      const repositoryPath = path.relative(repoRoot, fullPath).split(path.sep).join("/");
      const source = await readFile(fullPath, "utf8");
      violations.push(...collectCrossAppImportViolationsFromSource(repositoryPath, source, registry));
    }
  }

  if (violations.length > 0) {
    console.error("Cross-app import boundary violations found:");
    for (const violation of violations) {
      console.error(`- ${violation.filePath}:${violation.lineNumber} \`${violation.specifier}\` -> ${violation.reason}`);
    }
    console.error(
      "Move shared logic to packages/ (DTOs belong in packages/contracts) or call the owning app's HTTP API instead.",
    );
    return false;
  }

  console.log("Cross-app import check passed: apps do not import another app's private implementation.");
  return true;
}
