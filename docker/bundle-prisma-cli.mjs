import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

function collect(pkg, seen = new Set()) {
  if (seen.has(pkg)) return seen;
  seen.add(pkg);

  const parts = pkg.startsWith("@") ? pkg.split("/") : [pkg];
  const pkgJson = path.join("node_modules", ...parts, "package.json");
  if (!fs.existsSync(pkgJson)) return seen;

  const meta = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
  for (const dep of Object.keys({
    ...(meta.dependencies ?? {}),
    ...(meta.optionalDependencies ?? {}),
  })) {
    collect(dep, seen);
  }

  return seen;
}

const outRoot = "/prisma-bundle/node_modules";
fs.mkdirSync(outRoot, { recursive: true });

for (const pkg of collect("prisma")) {
  const parts = pkg.startsWith("@") ? pkg.split("/") : [pkg];
  const src = path.join("node_modules", ...parts);
  const dest = path.join(outRoot, ...parts);
  if (!fs.existsSync(src)) continue;

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execSync(`cp -r "${src}" "${dest}"`);
}

if (!fs.existsSync(path.join(outRoot, "effect", "package.json"))) {
  throw new Error("Prisma CLI bundle missing effect dependency");
}
