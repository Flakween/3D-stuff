/**
 * Caches for the renderer's textures and imported models.
 *
 * The caches belong to one project. When a different project is opened they
 * are dropped, because a texture or a model from the previous project must
 * never be shown for the new one.
 */

import * as THREE from "three";
import { assetGeneration, bumpAssetGeneration, clearAssetBytes } from "../persistence/assets.ts";
import { disposeImportedTemplate } from "./dispose.js";

export const textureLoader = new THREE.TextureLoader();

/** Textures created from the texture overrides of an object. */
export const textureCache = new Map();

/** Imported model templates, keyed by object id. */
export const importCache = new Map();

/** Pending imports, so a model is only parsed once. */
export const importPromises = new Map();

export { assetGeneration };

/** Drop every cached texture and model. Called when the project changes. */
export function clearProjectAssetCaches() {
  bumpAssetGeneration();
  for (const texture of textureCache.values()) texture.dispose();
  for (const template of importCache.values()) disposeImportedTemplate(template);
  textureCache.clear();
  importCache.clear();
  importPromises.clear();
  clearAssetBytes();
}
