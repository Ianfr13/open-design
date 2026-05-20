import { lstat, mkdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";

import { SIDECAR_ENV } from "@open-design/sidecar-proto";

type WebSidecarRuntimeEnv = Pick<NodeJS.ProcessEnv, typeof SIDECAR_ENV.WEB_DIST_DIR | typeof SIDECAR_ENV.WEB_TSCONFIG_PATH>;

function resolveConfiguredPath(configured: string | undefined, baseDir: string): string | null {
  if (configured == null || configured.length === 0) return null;
  return isAbsolute(configured) ? configured : join(baseDir, configured);
}

function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

export function resolveWebRuntimeRoot(options: {
  env?: WebSidecarRuntimeEnv;
  webRoot: string;
}): string | null {
  const env = options.env ?? process.env;
  const distDir = resolveConfiguredPath(env[SIDECAR_ENV.WEB_DIST_DIR], options.webRoot);
  return distDir == null ? null : dirname(distDir);
}

export function resolveWebDevTsconfigPath(options: {
  env?: WebSidecarRuntimeEnv;
  webRoot: string;
}): string | null {
  const env = options.env ?? process.env;
  return resolveConfiguredPath(env[SIDECAR_ENV.WEB_TSCONFIG_PATH], options.webRoot);
}

async function ensureWebRuntimeModules(options: {
  runtimeRoot: string;
  webRoot: string;
}): Promise<void> {
  const runtimeNodeModules = join(options.runtimeRoot, "node_modules");
  const webNodeModules = join(options.webRoot, "node_modules");

  await mkdir(options.runtimeRoot, { recursive: true });
  const current = await lstat(runtimeNodeModules).catch(() => null);
  if (current?.isSymbolicLink()) {
    const currentTarget = await readlink(runtimeNodeModules).catch(() => null);
    if (currentTarget === webNodeModules) return;
  }
  if (current != null) await rm(runtimeNodeModules, { force: true, recursive: true });
  await symlink(webNodeModules, runtimeNodeModules, "junction");
}

async function writeWebDevTsconfig(options: {
  tsconfigPath: string;
  webRoot: string;
}): Promise<void> {
  const tsconfigDir = dirname(options.tsconfigPath);
  const sourceTsconfig = join(options.webRoot, "tsconfig.json");
  const relativeSourceTsconfig = toPosixPath(relative(tsconfigDir, sourceTsconfig) || "./tsconfig.json");

  await mkdir(tsconfigDir, { recursive: true });
  await writeFile(
    options.tsconfigPath,
    `${JSON.stringify({
      extends: relativeSourceTsconfig,
      compilerOptions: {
        plugins: [{ name: "next" }],
      },
    }, null, 2)}\n`,
    "utf8",
  );
}

export async function prepareWebSidecarDevRuntime(options: {
  env?: WebSidecarRuntimeEnv;
  webRoot: string;
}): Promise<void> {
  const runtimeRoot = resolveWebRuntimeRoot(options);
  if (runtimeRoot != null) {
    await ensureWebRuntimeModules({ runtimeRoot, webRoot: options.webRoot });
  }

  const tsconfigPath = resolveWebDevTsconfigPath(options);
  if (tsconfigPath != null) {
    await writeWebDevTsconfig({ tsconfigPath, webRoot: options.webRoot });
  }
}
