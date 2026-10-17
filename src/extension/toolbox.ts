/**
 * The 3D blocks in Scratch's own categories.
 *
 * TurboWarp lets an editor add blocks to the built in categories. The 2D
 * blocks are kept as well: they remain useful for older projects and make
 * Motion available while the 3D palette is refreshing.
 */

export interface ToolboxCategories {
  motion: string;
  looks: string;
}

export function buildToolbox(categories: ToolboxCategories): ToolboxCategories {
  const number = (name: string, value: number | string): string =>
    '<value name="' +
    name +
    '"><shadow type="math_number"><field name="NUM">' +
    value +
    "</field></shadow></value>";
  const block = (opcode: string, inputs = ""): string =>
    '<block type="dango3d_' + opcode + '">' + inputs + "</block>";

  const motionBlocks =
    '<label text="3D movement"></label>' +
    block("moveSteps3D", number("STEPS", 10)) +
    block("turnRight3D", number("DEGREES", 15)) +
    block("turnLeft3D", number("DEGREES", 15)) +
    block("pointDirection3D", number("DIRECTION", 90) + number("PITCH", 0)) +
    '<sep gap="32"/>' +
    block("goToPosition3D", number("X", 0) + number("Y", 0) + number("Z", 0)) +
    block("glideToPosition3D", number("SECS", 1) + number("X", 0) + number("Y", 0) + number("Z", 0)) +
    '<sep gap="32"/>' +
    (["X", "Y", "Z"] as const)
      .map((axis) =>
        block(`change${axis}3D`, number("DELTA", 10)) +
        block(`set${axis}3D`, number("VALUE", 0)),
      )
      .join("") +
    '<sep gap="32"/>' +
    block("xPosition3D") +
    block("yPosition3D") +
    block("zPosition3D") +
    block("direction3D") +
    '<label text="3D orientation"></label>' +
    block("setYaw", number("ANGLE", 0)) +
    block("changeYaw", number("DELTA", 15)) +
    block("yaw") +
    block("setPitch", number("ANGLE", 0)) +
    block("changePitch", number("DELTA", 15)) +
    block("pitch") +
    block("setRoll", number("ANGLE", 0)) +
    block("changeRoll", number("DELTA", 15)) +
    block("roll");

  const looksBlocks =
    '<label text="3D models"></label>' +
    block(
      "selectModel",
      '<value name="MODEL"><shadow type="text"><field name="TEXT">model1</field></shadow></value>',
    ) +
    block("modelName");

  const append = (category: string, blocks: string): string =>
    category.replace(/<\/category>\s*$/, '<sep gap="36"/>' + blocks + "</category>");

  return {
    motion: append(categories.motion, motionBlocks),
    looks: append(categories.looks, looksBlocks),
  };
}

/** Install the toolbox hook the editor calls when it builds the palette. */
export function installToolbox(): void {
  (globalThis as { dango3dToolbox?: (motion: string, looks: string) => ToolboxCategories })
    .dango3dToolbox = (motion: string, looks: string) => buildToolbox({ motion, looks });
}
