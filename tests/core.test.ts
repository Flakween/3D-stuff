import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  defaultCone,
  isBase64Payload,
  migrateProjectScene,
  normalizeActor,
  normalizeActors,
  normalizeMaps,
  normalizeObject,
  normalizeSceneSettings,
  normalizeScenes,
  normalizeSource,
  safeAssetId,
  safeModelName,
  uniqueId,
  vector3,
} from "../src/core/schema.ts";
import {
  SCRATCH_UNITS_PER_WORLD_UNIT,
  forwardStep3D,
  heightInScratchUnits,
  normalizeDirection,
  scratchTargetPose,
} from "../src/core/coordinates.ts";
import { sanitizeObjectHierarchy } from "../src/core/hierarchy.ts";
import type { HierarchicalObject } from "../src/core/hierarchy.ts";

describe("schema", () => {
  test("an object with no data becomes a white cube", () => {
    const object = normalizeObject({});
    assert.equal(object.type, "cube");
    assert.equal(object.color, "#ffffff");
    assert.deepEqual(object.position, [0, 0, 0]);
    assert.deepEqual(object.scale, [1, 1, 1]);
    assert.equal(object.parent, null);
    assert.equal(object.source, null);
  });

  test("unknown types fall back to a cube", () => {
    assert.equal(normalizeObject({ type: "dodecahedron" }).type, "cube");
    assert.equal(normalizeObject({ type: "import" }).type, "import");
  });

  test("coordinates are clamped to a sane range", () => {
    const object = normalizeObject({ position: [1e12, -1e12, 0] });
    assert.equal(object.position[0], 1e6);
    assert.equal(object.position[1], -1e6);
  });

  test("subdivisions are rounded to a power of two", () => {
    assert.equal(normalizeObject({ subdivisions: 3 }).subdivisions, 4);
    assert.equal(normalizeObject({ subdivisions: 5 }).subdivisions, 8);
    assert.equal(normalizeObject({ subdivisions: 0 }).subdivisions, 1);
    assert.equal(normalizeObject({ subdivisions: 999 }).subdivisions, 16);
  });

  test("colors have to look like colors", () => {
    assert.equal(normalizeObject({ color: "red" }).color, "#ffffff");
    assert.equal(normalizeObject({ color: "#AABBCC" }).color, "#AABBCC");
  });

  test("texture overrides only accept embedded images", () => {
    const maps = normalizeMaps({
      texture: "data:image/png;base64,AAAA",
      roughness: "https://example.com/rough.png",
      normal: "data:text/html,<script>",
    });
    assert.equal(maps.texture, "data:image/png;base64,AAAA");
    assert.equal(maps.roughness, undefined);
    assert.equal(maps.normal, undefined);
  });

  test("an asset id has to be safe to use as a file name", () => {
    assert.equal(safeAssetId("abc-123_x"), "abc-123_x");
    assert.equal(safeAssetId("../escape"), null);
    assert.equal(safeAssetId(""), null);
  });

  test("a source needs a safe asset id", () => {
    assert.equal(normalizeSource({ assetId: "ok", format: "obj" })?.format, "obj");
    assert.equal(normalizeSource({ assetId: "ok", format: "exe" })?.format, "glb");
    assert.equal(normalizeSource({ assetId: "../x" }), null);
    assert.equal(normalizeSource(null), null);
  });

  test("base64 payloads are recognized, data URL headers are checked", () => {
    assert.equal(isBase64Payload("aGVsbG8="), true);
    assert.equal(isBase64Payload("aGVsbG8"), true);
    assert.equal(isBase64Payload("data:image/png;base64,aGVsbG8="), true);
    // A data URL that does not declare base64 is rejected.
    assert.equal(isBase64Payload("data:text/html,AAAA"), false);
    assert.equal(isBase64Payload("not base64!!"), false);
  });

  test("an actor without models still has one model", () => {
    const actor = normalizeActor({ name: "Sprite1" });
    assert.equal(actor.models.length, 1);
    assert.equal(actor.models[0].name, "model1");
    assert.equal(actor.active, 0);
  });

  test("the active model index stays inside the model list", () => {
    const actor = normalizeActor({ models: [{ id: "a" }, { id: "b" }], active: 9 });
    assert.equal(actor.active, 1);
  });

  test("object ids are unique inside a model", () => {
    const actor = normalizeActor({
      models: [{ id: "m", objects: [{ id: "x" }, { id: "x" }, { id: "x" }] }],
    });
    const ids = actor.models[0].objects.map((object) => object.id);
    assert.equal(new Set(ids).size, 3);
  });

  test("actors are keyed by their name", () => {
    const actors = normalizeActors({ key1: { name: "Sprite1" }, key2: { name: "Sprite2" } });
    assert.deepEqual(Object.keys(actors), ["Sprite1", "Sprite2"]);
  });

  test("names are trimmed to a length that fits in a file", () => {
    assert.equal(safeModelName("x".repeat(500)).length, 256);
    assert.equal(safeModelName("", "fallback"), "fallback");
    assert.equal(safeModelName(undefined, undefined), "Model");
  });

  test("scene settings are clamped", () => {
    const settings = normalizeSceneSettings({
      skyMode: "nonsense",
      fogDensity: 5,
      exposure: 99,
      shadows: false,
      skyColor: "not a color",
    });
    assert.equal(settings.skyMode, "gradient");
    assert.equal(settings.fogDensity, 0.1);
    assert.equal(settings.exposure, 3);
    assert.equal(settings.shadows, false);
    assert.equal(settings.skyColor, "#ff9c5c");
  });

  test("scenes that are not objects are dropped", () => {
    const scenes = normalizeScenes([{ name: "A" }, null, 5, { name: "B" }]);
    assert.equal(scenes.length, 2);
    assert.equal(scenes[1].name, "B");
  });

  test("the default cone is a cone", () => {
    const cone = defaultCone();
    assert.equal(cone.type, "cone");
    assert.equal(cone.subdivisions, 4);
  });

  test("ids are made unique", () => {
    const used = new Set(["a"]);
    assert.notEqual(uniqueId("a", used), "a");
    assert.equal(used.size, 2);
  });

  test("vector helpers keep three components", () => {
    assert.deepEqual(vector3([1, 2], [0, 0, 0]), [1, 2, 0]);
    assert.deepEqual(vector3("nope", [1, 2, 3]), [1, 2, 3]);
  });

  test("a project payload is migrated to the current schema", () => {
    const migrated = migrateProjectScene({
      schemaVersion: 0,
      actors: { Sprite1: { name: "Sprite1", models: [{ id: "m", objects: [] }] } },
      scenes: [{ name: "Scene 1" }],
      assets: [{ assetId: "ok" }, { assetId: "../bad" }],
    });
    assert.equal(migrated.schemaVersion, 1);
    assert.equal(migrated.actors.Sprite1.models.length, 1);
    assert.equal(migrated.scenes.length, 1);
    assert.equal(migrated.assets.length, 1);
  });
});

describe("coordinates", () => {
  test("Scratch coordinates map to a Y up world", () => {
    const pose = scratchTargetPose({ x: 60, y: 120, direction: 90, size: 100 });
    assert.deepEqual(pose.position, [1, 0, -2]);
    assert.equal(pose.scale, 1);
  });

  test("the actor faces local +X", () => {
    const pose = scratchTargetPose({ x: 0, y: 0, direction: 90 });
    assert.equal(pose.rotation[1], 0);
    const turned = scratchTargetPose({ x: 0, y: 0, direction: 0 });
    assert.equal(Math.round(turned.rotation[1]), Math.round(Math.PI / 2));
  });

  test("a yaw offset rotates the actor around the world Y axis", () => {
    const pose = scratchTargetPose({ x: 0, y: 0, direction: 90 }, { yaw: 45 });
    assert.equal(pose.rotation[1], Math.PI / 4);
  });

  test("moving forward uses the heading", () => {
    // The 3D stage measures the heading from the world X axis, so direction 90
    // walks towards +X and direction 0 towards +Y. See docs/ARCHITECTURE.md.
    const step = forwardStep3D({ x: 0, y: 0, direction: 90 }, {}, 10);
    assert.ok(Math.abs(step.x - 10) < 1e-9);
    assert.ok(Math.abs(step.y - 0) < 1e-9);
    assert.equal(step.z, 0);
  });

  test("the forward step agrees with the rendered pose", () => {
    for (const direction of [0, 45, 90, 180, -90]) {
      const step = forwardStep3D({ x: 0, y: 0, direction }, {}, 60);
      const pose = scratchTargetPose({ x: 0, y: 0, direction });
      // The pose faces local +X, which after the yaw rotation points at
      // (cos yaw, 0, -sin yaw) in the world.
      const yaw = pose.rotation[1];
      const worldX = step.x / SCRATCH_UNITS_PER_WORLD_UNIT;
      const worldZ = -step.y / SCRATCH_UNITS_PER_WORLD_UNIT;
      assert.ok(Math.abs(worldX - Math.cos(yaw)) < 1e-9, `x for ${direction}`);
      assert.ok(Math.abs(worldZ + Math.sin(yaw)) < 1e-9, `z for ${direction}`);
    }
  });

  test("pitch lifts the step out of the plane", () => {
    const step = forwardStep3D({ x: 0, y: 0, direction: 90 }, { pitch: 90 }, 60);
    assert.ok(Math.abs(step.x) < 1e-9);
    assert.ok(Math.abs(step.y) < 1e-9);
    assert.ok(Math.abs(step.z - 60) < 1e-9);
  });

  test("height is reported in Scratch units", () => {
    assert.equal(heightInScratchUnits(1), SCRATCH_UNITS_PER_WORLD_UNIT);
    assert.equal(heightInScratchUnits(0), 0);
  });

  test("directions are normalized into the range the VM uses", () => {
    assert.equal(normalizeDirection(90), 90);
    assert.equal(normalizeDirection(270), -90);
    assert.equal(normalizeDirection(450), 90);
    assert.equal(normalizeDirection(-90), -90);
    assert.equal(normalizeDirection("nope"), 90);
  });
});

describe("hierarchy", () => {
  test("a cycle is broken instead of hanging the renderer", () => {
    const objects: HierarchicalObject[] = [
      { id: "a", parent: "b" },
      { id: "b", parent: "a" },
    ];
    sanitizeObjectHierarchy(objects);
    const parents = objects.map((object) => object.parent);
    assert.ok(parents.includes(null), "one of the objects has to become a root");
  });

  test("a parent that does not exist is dropped", () => {
    const objects: HierarchicalObject[] = [{ id: "a", parent: "ghost" }];
    sanitizeObjectHierarchy(objects);
    assert.equal(objects[0].parent, null);
  });

  test("a valid hierarchy is left alone", () => {
    const objects: HierarchicalObject[] = [
      { id: "a", parent: null },
      { id: "b", parent: "a" },
      { id: "c", parent: "b" },
    ];
    sanitizeObjectHierarchy(objects);
    assert.deepEqual(
      objects.map((object) => object.parent),
      [null, "a", "b"],
    );
  });

  test("a very deep hierarchy does not overflow the stack", () => {
    const objects: HierarchicalObject[] = Array.from({ length: 50000 }, (_, index) => ({
      id: `o${index}`,
      parent: index === 0 ? null : `o${index - 1}`,
    }));
    assert.doesNotThrow(() => sanitizeObjectHierarchy(objects));
    assert.equal(objects[0].parent, null);
  });
});
