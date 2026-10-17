/**
 * Build the 3D engine.
 *
 * The editor itself is TurboWarp's prebuilt bundle, which is vendored in this
 * repository. Everything under `src/` is ours and is compiled here.
 *
 * three.js is bundled at a pinned version, so the editor does not depend on a
 * content delivery network at runtime.
 */

import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "dist");
const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production") || !watch;

const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

/** The version of three.js that is bundled. */
const threeVersion = pkg.devDependencies.three;

const shared = {
  bundle: true,
  logLevel: "info",
  minify: production,
  sourcemap: production ? false : "inline",
  target: ["es2022"],
  legalComments: "none",
  define: {
    "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development"),
  },
};

/** The 3D engine. Loaded as a module by the editor. */
const engine = {
  ...shared,
  entryPoints: [resolve(root, "src/index.js")],
  outfile: resolve(outDir, "dango3d.js"),
  format: "esm",
  banner: {
    js: `/* Dango Cat 3D engine. Built from src/ - do not edit by hand. */`,
  },
};

/** Small scripts that have to run before the editor boots. */
const shell = ["title", "mobile", "toolbar-controls"].map((name) => ({
  ...shared,
  entryPoints: [resolve(root, `src/shell/${name}.js`)],
  outfile: resolve(outDir, `shell/${name}.js`),
  format: "iife",
  minify: false,
  sourcemap: false,
}));

async function copyStyles() {
  await mkdir(resolve(outDir, "styles"), { recursive: true });
  await cp(resolve(root, "src/styles"), resolve(outDir, "styles"), { recursive: true });
}

async function writeManifest() {
  // The manifest deliberately has no timestamp: the build has to be
  // reproducible so CI can check that dist/ matches the sources.
  const manifest = {
    name: pkg.name,
    version: pkg.version,
    three: threeVersion,
    files: [],
  };
  for (const file of ["dango3d.js", "styles/dango3d.css", "styles/turbowarp.css"]) {
    const info = await stat(resolve(outDir, file));
    manifest.files.push({ path: file, bytes: info.size });
  }
  await writeFile(resolve(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function run() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(resolve(outDir, "shell"), { recursive: true });

  await copyStyles();
  await build(engine);
  for (const entry of shell) await build(entry);
  await writeManifest();

  console.log(`\nBuilt the 3D engine into ${outDir} (three ${threeVersion}).`);
}

if (watch) {
  await copyStyles();
  const contexts = await Promise.all([engine, ...shell].map((entry) => context(entry)));
  await Promise.all(contexts.map((entry) => entry.watch()));
  console.log("Watching for changes...");
} else {
  await run();
}
