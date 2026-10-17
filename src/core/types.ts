/**
 * Data model for the 3D engine.
 *
 * Everything in `core/` is pure data plus pure functions: no DOM, no three.js,
 * no VM. That keeps the model importable from the editor, from the runtime
 * stage, and from tests, and it makes schema migrations safe to reason about.
 */

/** Primitives the editor can author plus the two special object kinds. */
export type ObjectType =
  | "cube"
  | "sphere"
  | "cone"
  | "cylinder"
  | "plane"
  | "torus"
  | "star"
  | "import"
  | "empty";

/** Texture slots a material can override. */
export type MapType = "texture" | "roughness" | "metallic" | "normal" | "opacity";

/** A 3 component vector stored as a plain tuple so it survives JSON. */
export type Vector3Tuple = [number, number, number];

/** Where the bytes of an imported model live. */
export interface AssetSource {
  /** `glb`, `gltf` or `obj`. */
  format: "glb" | "gltf" | "obj";
  /** Id of the file inside the project's asset store. */
  assetId: string;
  /** Optional inline copy of the file, used when the asset store is empty. */
  data?: string;
}

/** One node inside a model. */
export interface ModelObject {
  id: string;
  name: string;
  type: ObjectType;
  /** Id of the parent object, or null for a root object. */
  parent: string | null;
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
  /** Transform applied to the mesh inside this object's group. */
  meshPosition: Vector3Tuple;
  meshRotation: Vector3Tuple;
  meshScale: Vector3Tuple;
  color: string;
  metallic: number;
  smoothness: number;
  opacity: number;
  /** When false an imported mesh keeps the material it was authored with. */
  materialOverride: boolean;
  subdivisions: number;
  linear: boolean;
  points: number;
  innerAngle: number;
  width: number;
  depth: number;
  height: number;
  /** Texture overrides, stored as data URLs. */
  maps: Partial<Record<MapType, string>>;
  /** Set for `import` objects. */
  source: AssetSource | null;
}

/** A named collection of objects. */
export interface Model {
  id: string;
  name: string;
  objects: ModelObject[];
}

/** Per actor orientation offsets that have no Scratch equivalent. */
export interface Transform3D {
  /** Height above the ground, in world units. */
  height: number;
  /** Extra yaw around the world Y axis, in degrees. */
  yaw: number;
  /** Pitch around the actor's local Z axis, in degrees. */
  pitch: number;
  /** Roll around the actor's local X axis, in degrees. */
  roll: number;
}

/** Everything the engine knows about one Scratch sprite. */
export interface Actor {
  name: string;
  /** Index into `models` of the model this actor shows. */
  active: number;
  transform3D: Transform3D;
  models: Model[];
}

/** Renderer settings owned by a stage costume. */
export interface SceneSettings {
  skyMode: "gradient" | "color" | "texture";
  skyColor: string;
  skyTexture: string | null;
  fogEnabled: boolean;
  fogColor: string;
  fogDensity: number;
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  shadows: boolean;
  groundColor: string;
  ambient: number;
  sun: number;
}

/** One stage costume plus the scene settings that go with it. */
export interface Scene {
  name: string;
  settings: SceneSettings;
}

/** Actors keyed by actor name, which is how they are serialized. */
export type ActorMap = Record<string, Actor>;

/** The 3D payload stored inside a Scratch project file. */
export interface ProjectScene {
  schemaVersion: number;
  projectId: string | null;
  signature: string | null;
  coordinates: {
    up: "Y";
    scratchX: "X";
    scratchY: "-Z";
    unitsPerStep: number;
  };
  actors: ActorMap;
  scenes: Scene[];
  assets: Array<{ assetId: string; format: string }>;
  advancedSettings?: unknown;
}
