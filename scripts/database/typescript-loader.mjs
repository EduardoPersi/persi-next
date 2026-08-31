import { resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, statSync } from "node:fs";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const absolute = resolvePath(process.cwd(), specifier.slice(2));
    if (existsSync(absolute) && statSync(absolute).isDirectory()) {
      return nextResolve(pathToFileURL(resolvePath(absolute, "index.ts")).href, context);
    }
    try { return await nextResolve(pathToFileURL(absolute).href, context); }
    catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
      return nextResolve(pathToFileURL(`${absolute}.ts`).href, context);
    }
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code === "ERR_UNSUPPORTED_DIR_IMPORT" && specifier.startsWith(".")) {
      const directory=fileURLToPath(new URL(specifier, context.parentURL));
      return nextResolve(pathToFileURL(resolvePath(directory,"index.ts")).href,context);
    }
    if (error?.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw error;
    return nextResolve(`${specifier}.ts`, context);
  }
}
