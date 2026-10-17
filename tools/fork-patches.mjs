/**
 * Re-apply the changes this fork makes to TurboWarp's editor source.
 *
 * The editor in `js/` is a prebuilt bundle, so the three places where the
 * 3D engine reaches into the editor were patched in the bundle rather than
 * in the source. This script applies the same three patches to a checkout of
 * TurboWarp/scratch-gui, which is the first step of moving the editor back
 * to source.
 *
 *   git clone --depth 1 https://github.com/TurboWarp/scratch-gui.git
 *   node tools/fork-patches.mjs ../scratch-gui
 *
 * The script is idempotent: a patch that is already applied is skipped.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve(process.argv[2] || "../scratch-gui");

/** Every patch, in the order they have to be applied. */
const patches = [
  {
    file: "src/lib/make-toolbox-xml.js",
    name: "put the 3D blocks in the Motion and Looks categories",
    edits: [
      {
        find: "    const motionXML = moveCategory('motion') ||",
        replace: "    let motionXML = moveCategory('motion') ||",
      },
      {
        find: "    const looksXML = moveCategory('looks') ||",
        replace: "    let looksXML = moveCategory('looks') ||",
      },
      {
        find: "    const myBlocksXML = moveCategory('procedures') || myBlocks(isInitialSetup, isStage, targetId, colors.more);\n",
        replace:
          "    const myBlocksXML = moveCategory('procedures') || myBlocks(isInitialSetup, isStage, targetId, colors.more);\n" +
          "\n" +
          "    // Dango Cat 3D: add the 3D blocks to the native categories and let the\n" +
          "    // 3D extension show up as its own category.\n" +
          "    if (!isStage && !isInitialSetup && window.dango3dToolbox) {\n" +
          "        const integrated = window.dango3dToolbox(motionXML, looksXML);\n" +
          "        motionXML = integrated.motion;\n" +
          "        looksXML = integrated.looks;\n" +
          "        moveCategory('dango3d');\n" +
          "    }\n",
      },
    ],
  },
  {
    file: "src/lib/project-saver-hoc.jsx",
    name: "use the 3D stage for the project thumbnail",
    edits: [
      {
        find: "        getProjectThumbnail (callback) {\n",
        replace:
          "        getProjectThumbnail (callback) {\n" +
          "            // Dango Cat 3D: prefer a frame of the 3D stage.\n" +
          "            const threeDFrame = window.dango3dStageCapture?.();\n" +
          "            if (threeDFrame) {\n" +
          "                callback(threeDFrame);\n" +
          "                return;\n" +
          "            }\n",
      },
    ],
  },
  {
    file: "src/lib/tw-restore-point-api.js",
    name: "use the 3D stage for restore point thumbnails",
    edits: [
      {
        find: "const generateThumbnail = vm => new Promise(resolve => {\n",
        replace:
          "const generateThumbnail = vm => new Promise(resolve => {\n" +
          "    // Dango Cat 3D: prefer a frame of the 3D stage.\n" +
          "    const threeDFrame = window.dango3dStageCapture?.();\n" +
          "    if (threeDFrame) {\n" +
          "        const base64 = threeDFrame.substring(threeDFrame.indexOf(',') + 1);\n" +
          "        resolve({\n" +
          "            type: 'image/png',\n" +
          "            data: base64ToArrayBuffer(base64)\n" +
          "        });\n" +
          "        return;\n" +
          "    }\n",
      },
    ],
  },
];

let changed = 0;
let skipped = 0;

for (const patch of patches) {
  const path = resolve(target, patch.file);
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    console.error(`missing ${patch.file}, is ${target} a scratch-gui checkout?`);
    process.exitCode = 1;
    continue;
  }

  let applied = 0;
  for (const edit of patch.edits) {
    if (text.includes(edit.replace)) continue; // already applied
    if (!text.includes(edit.find)) {
      console.error(`  ! ${patch.file}: the anchor text was not found:\n    ${edit.find.trim()}`);
      process.exitCode = 1;
      continue;
    }
    text = text.replace(edit.find, edit.replace);
    applied++;
  }

  if (applied) {
    await writeFile(path, text);
    changed++;
    console.log(`patched ${patch.file} (${patch.name})`);
  } else {
    skipped++;
    console.log(`already patched ${patch.file} (${patch.name})`);
  }
}

console.log(`\n${changed} file(s) patched, ${skipped} already up to date.`);
console.log(
  "Next: copy src/ from this repository into the checkout's src/lib/3d/ and\n" +
    "import it from the editor entry point.",
);
