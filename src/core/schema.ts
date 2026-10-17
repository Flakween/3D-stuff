/**
 * Schema normalization and migration for the 3D data model.
 *
 * Every value that comes from a project file, a local storage cache or an
 * import passes through here. The normalizers are intentionally total: they
 * never throw, they clamp hostile input into a usable range, and they drop
 * anything they cannot make sense of.
 */

import type {
  Actor,
  ActorMap,
  AssetSource,
  MapType,
  Model,
  ModelObject,
  ObjectType,
  Scene,
  SceneSettings,
  Vector3Tuple,
} from "./types.ts";

export const OBJECT_TYPES: ReadonlySet<ObjectType> = new Set<ObjectType>([
  "cube",
  "sphere",
  "cone",
  "cylinder",
  "plane",
  "torus",
  "star",
  "import",
  "empty",
]);

export const MAP_TYPES: ReadonlySet<MapType> = new Set<MapType>([
  "texture",
  "roughness",
  "metallic",
  "normal",
  "opacity",
]);

export const ASSET_FORMATS = ["glb", "gltf", "obj"] as const;

/** Asset ids become file names inside the project archive, so keep them tame. */
export const SAFE_ASSET_ID = /^[a-z0-9_-]{1,128}$/i;

/** Upper bound for any coordinate that can be typed into the editor. */
export const MODEL_COORDINATE_LIMIT = 1e6;

/** Version of the payload stored in the project archive. */
export const PROJECT_SCHEMA_VERSION = 1;

/** Version of the payload stored in the local storage cache. */
export const CACHE_SCHEMA_VERSION = 2;

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const uid = (): string => {
  const cryptoRef = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  // Fallback for non secure contexts, where randomUUID is unavailable.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export function finiteNumber(
  value: unknown,
  fallback: number,
  min: number = -Infinity,
  max: number = Infinity,
): number {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, min, max) : fallback;
}

export function vector3(value: unknown, fallback: Vector3Tuple): Vector3Tuple {
  const validArray = Array.isArray(value) || ArrayBuffer.isView(value);
  return fallback.map((defaultValue, index) =>
    validArray
      ? finiteNumber(
          (value as ArrayLike<unknown>)[index],
          defaultValue,
          -MODEL_COORDINATE_LIMIT,
          MODEL_COORDINATE_LIMIT,
        )
      : defaultValue,
  ) as Vector3Tuple;
}

export function safeModelName(value: unknown, fallback: unknown = "Model"): string {
  if (typeof value === "string" && value) return value.slice(0, 256);
  if (typeof fallback === "string" && fallback) return fallback.slice(0, 256);
  return "Model";
}

export function safeAssetId(value: unknown): string | null {
  return typeof value === "string" && SAFE_ASSET_ID.test(value) ? value : null;
}

export function uniqueId(value: unknown, used: Set<string>): string {
  let id =
    typeof value === "string" && value.length > 0 && value.length <= 128 ? value : uid();
  while (used.has(id)) id = uid();
  used.add(id);
  return id;
}

export function isBase64Payload(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const separator = value.lastIndexOf(",");
  const hasDataURLHeader = separator >= 0;
  if (hasDataURLHeader && !/^data:[^,]*;base64$/i.test(value.slice(0, separator))) {
    return false;
  }
  const payload = hasDataURLHeader ? value.slice(separator + 1) : value;
  const padded = /^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i;
  const unpadded = /^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2,3})?$/i;
  return padded.test(payload) || unpadded.test(payload);
}

export function normalizeMaps(value: unknown): Partial<Record<MapType, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const maps: Partial<Record<MapType, string>> = {};
  for (const key of MAP_TYPES) {
    const url = (value as Record<string, unknown>)[key];
    // Textures created by this editor are embedded data URLs. Reject remote
    // URLs from imported project data to avoid unexpected third-party requests.
    if (typeof url === "string" && /^data:image\//i.test(url)) maps[key] = url;
  }
  return maps;
}

export function normalizeSource(value: unknown): AssetSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const assetId = safeAssetId(record.assetId);
  if (!assetId) return null;
  const format = ASSET_FORMATS.includes(record.format as (typeof ASSET_FORMATS)[number])
    ? (record.format as AssetSource["format"])
    : "glb";
  const source: AssetSource = { format, assetId };
  if (typeof record.data === "string" && isBase64Payload(record.data)) {
    source.data = record.data;
  }
  return source;
}

/** Normalize a single object inside a model. */
export function normalizeObject(value: unknown): ModelObject {
  const obj = (value ?? {}) as Record<string, unknown>;
  const type = OBJECT_TYPES.has(obj.type as ObjectType)
    ? (obj.type as ObjectType)
    : "cube";
  return {
    id:
      typeof obj.id === "string" && obj.id.length > 0 && obj.id.length <= 128
        ? obj.id
        : uid(),
    name: safeModelName(obj.name, typeof obj.type === "string" ? obj.type : "cube"),
    type,
    parent:
      typeof obj.parent === "string" && obj.parent.length > 0 && obj.parent.length <= 128
        ? obj.parent
        : null,
    position: vector3(obj.position, [0, 0, 0]),
    rotation: vector3(obj.rotation, [0, 0, 0]),
    scale: vector3(obj.scale, [1, 1, 1]),
    meshPosition: vector3(obj.meshPosition, [0, 0, 0]),
    meshRotation: vector3(obj.meshRotation, [0, 0, 0]),
    meshScale: vector3(obj.meshScale, [1, 1, 1]),
    color:
      typeof obj.color === "string" && /^#[0-9a-f]{6}$/i.test(obj.color)
        ? obj.color
        : "#ffffff",
    metallic: finiteNumber(obj.metallic, 0.1, 0, 1),
    smoothness: finiteNumber(obj.smoothness, 0.72, 0, 1),
    opacity: finiteNumber(obj.opacity, 1, 0, 1),
    materialOverride:
      typeof obj.materialOverride === "boolean"
        ? obj.materialOverride
        : obj.type !== "import",
    subdivisions: 2 ** Math.ceil(Math.log2(finiteNumber(obj.subdivisions, 1, 1, 16))),
    linear: !!obj.linear,
    points: Math.round(finiteNumber(obj.points, 5, 3, 24)),
    innerAngle: finiteNumber(obj.innerAngle, 120, 30, 175),
    width: finiteNumber(obj.width, 1, 0.05, 10000),
    depth: finiteNumber(obj.depth, 1, 0.05, 10000),
    height: finiteNumber(obj.height, 1, 0.05, 10000),
    maps: normalizeMaps(obj.maps),
    source: normalizeSource(obj.source),
  };
}

/** The cone an actor starts with when it has no saved model yet. */
export function defaultCone(): ModelObject {
  return normalizeObject({
    type: "cone",
    name: "Cone",
    width: 1.65,
    depth: 1.65,
    height: 2.7,
    position: [0, 1.35, 0],
    metallic: 0.88,
    smoothness: 0.85,
    color: "#ffffff",
    subdivisions: 4,
  });
}

/**
 * Normalize one actor. The hierarchy of every model is sanitized afterwards
 * by `sanitizeObjectHierarchy`, which this module calls through the caller
 * because the fix is graph shaped rather than field shaped.
 */
export function normalizeActor(data: unknown, fallbackName: string = "Actor"): Actor {
  const record = (data ?? {}) as Record<string, unknown>;
  const models = Array.isArray(record.models)
    ? record.models.filter((model) => model && typeof model === "object")
    : [];
  const usedModelIds = new Set<string>();
  const transform = (record.transform3D ?? {}) as Record<string, unknown>;
  return {
    name: safeModelName(record.name, fallbackName),
    active: Math.round(
      clamp(finiteNumber(record.active, 0), 0, Math.max(models.length - 1, 0)),
    ),
    transform3D: {
      height: finiteNumber(transform.height, 0, -MODEL_COORDINATE_LIMIT, MODEL_COORDINATE_LIMIT),
      yaw: finiteNumber(transform.yaw, 0, -MODEL_COORDINATE_LIMIT, MODEL_COORDINATE_LIMIT),
      pitch: finiteNumber(transform.pitch, 0, -MODEL_COORDINATE_LIMIT, MODEL_COORDINATE_LIMIT),
      roll: finiteNumber(transform.roll, 0, -MODEL_COORDINATE_LIMIT, MODEL_COORDINATE_LIMIT),
    },
    models: models.length
      ? models.map((model, index) => {
          const modelRecord = model as Record<string, unknown>;
          const usedObjectIds = new Set<string>();
          const objects = Array.isArray(modelRecord.objects)
            ? modelRecord.objects
                .filter((object) => object && typeof object === "object")
                .map((object) => {
                  const normalized = normalizeObject(object);
                  normalized.id = uniqueId(normalized.id, usedObjectIds);
                  return normalized;
                })
            : [];
          return {
            id: uniqueId(modelRecord.id, usedModelIds),
            name: safeModelName(modelRecord.name, `Model ${index + 1}`),
            objects,
          } as Model;
        })
      : [{ id: uid(), name: "model1", objects: [] }],
  };
}

/** Normalize a map of actors, keyed by actor name. */
export function normalizeActors(source: unknown): ActorMap {
  const result: ActorMap = Object.create(null);
  for (const [key, value] of Object.entries((source ?? {}) as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const name = safeModelName((value as Record<string, unknown>).name, key);
    result[name] = normalizeActor(value, name);
  }
  return result;
}

export function defaultSceneSettings(): SceneSettings {
  return {
    skyMode: "gradient",
    skyColor: "#ff9c5c",
    skyTexture: null,
    fogEnabled: false,
    fogColor: "#ffffff",
    fogDensity: 0.015,
    exposure: 1.25,
    brightness: 1,
    contrast: 1,
    saturation: 1,
    shadows: true,
    groundColor: "#999b9d",
    ambient: 1.7,
    sun: 3.2,
  };
}

export function normalizeSceneSettings(input: unknown = {}): SceneSettings {
  const source = (input || {}) as Record<string, unknown>;
  const result = defaultSceneSettings();
  if (["gradient", "color", "texture"].includes(source.skyMode as string)) {
    result.skyMode = source.skyMode as SceneSettings["skyMode"];
  }
  for (const key of ["skyColor", "fogColor", "groundColor"] as const) {
    if (typeof source[key] === "string" && /^#[0-9a-f]{6}$/i.test(source[key] as string)) {
      result[key] = source[key] as string;
    }
  }
  if (
    typeof source.skyTexture === "string" &&
    /^data:image\/(?:png|jpeg|webp);base64,/.test(source.skyTexture)
  ) {
    result.skyTexture = source.skyTexture;
  }
  const ranges: Array<[keyof SceneSettings, number, number]> = [
    ["fogDensity", 0, 0.1],
    ["exposure", 0.25, 3],
    ["brightness", 0.5, 1.5],
    ["contrast", 0.5, 1.5],
    ["saturation", 0, 2],
    ["ambient", 0, 4],
    ["sun", 0, 6],
  ];
  for (const [key, min, max] of ranges) {
    const value = Number(source[key as string]);
    if (Number.isFinite(value)) {
      (result as unknown as Record<string, number>)[key as string] = clamp(value, min, max);
    }
  }
  result.fogEnabled = !!source.fogEnabled;
  result.shadows = source.shadows !== false;
  return result;
}

export function normalizeScenes(source: unknown): Scene[] {
  if (!Array.isArray(source)) return [];
  return source
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        name: safeModelName(record.name, "Scene"),
        settings: normalizeSceneSettings(record.settings),
      };
    });
}

/**
 * Bring a stored project payload up to the current schema version.
 *
 * Version 1 is the first public format, so the migration is currently a
 * pass through. Later revisions are handled here so old projects keep
 * opening without the editor having to know about historical shapes.
 */
export function migrateProjectScene(payload: unknown): {
  schemaVersion: number;
  actors: ActorMap;
  scenes: Scene[];
  assets: Array<{ assetId: string; format: string }>;
  [key: string]: unknown;
} {
  const record = (payload ?? {}) as Record<string, unknown>;
  const version = finiteNumber(record.schemaVersion, 0);
  const assets = Array.isArray(record.assets)
    ? record.assets
        .filter((asset) => asset && typeof asset === "object")
        .map((asset) => {
          const assetRecord = asset as Record<string, unknown>;
          const assetId = safeAssetId(assetRecord.assetId);
          return {
            assetId: assetId ?? "",
            format: typeof assetRecord.format === "string" ? assetRecord.format : "glb",
          };
        })
        .filter((asset) => !!asset.assetId)
    : [];
  return {
    ...record,
    schemaVersion: Math.max(version, PROJECT_SCHEMA_VERSION),
    actors: normalizeActors(record.actors),
    scenes: normalizeScenes(record.scenes),
    assets,
  };
}
