import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("the built engine", () => {
  test("boots in a DOM and installs its hooks", async () => {
    const bundle = resolve(root, "dist/dango3d.js");
    assert.ok(
      existsSync(bundle),
      "dist/dango3d.js is missing, run `npm run build` before the tests",
    );

    const { stdout } = await run(process.execPath, [resolve(root, "tools/smoke-check.mjs")], {
      cwd: root,
    });
    assert.match(stdout, /ok - the toolbox hook is installed/);
    assert.match(stdout, /ok - the stage capture hook is installed/);
    assert.match(stdout, /ok - the 3D extension is registered with the extension manager/);
    assert.match(stdout, /ok - the project carries the 3D payload/);
    assert.doesNotMatch(stdout, /^not ok/m);
    const summary = stdout.match(/(\d+)\/(\d+) checks passed/);
    assert.ok(summary, "the boot check did not report a summary");
    assert.equal(summary[1], summary[2], "some boot checks failed");
  });
});
