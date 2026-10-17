import * as THREE from "three";
import { textureCache, textureLoader } from "./asset-cache.js";
import { requestRender } from "../app.ts";

export function applyMaps(mesh, d) {
  for (const [key, property] of [
    ["texture", "map"],
    ["roughness", "roughnessMap"],
    ["normal", "normalMap"],
    ["metallic", "metalnessMap"],
    ["opacity", "alphaMap"],
  ]) {
    const url = d.maps[key];
    if (!url) continue;
    const cacheKey = `${key}:${url}`;
    let texture = textureCache.get(cacheKey);
    if (!texture) {
      texture = textureLoader.load(
        url,
        () => requestRender(),
        undefined,
        (error) => console.warn(`Unable to load ${key} map`, error),
      );
      texture.colorSpace =
        key === "texture" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      textureCache.set(cacheKey, texture);
    }
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const item of materials) {
      if (!item) continue;
      if (item[property] === texture) continue;
      item[property] = texture;
      if (key === "opacity") item.transparent = true;
      item.needsUpdate = true;
    }
  }
}


export function setMaterialProperties(mesh, data) {
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  for (const item of materials) {
    if (!item) continue;
    item.color?.set(data.color);
    if ("metalness" in item) item.metalness = data.metallic;
    if ("roughness" in item) item.roughness = 1 - data.smoothness;
    item.opacity = data.opacity;
    const transparent = data.opacity < 1 || !!data.maps.opacity;
    if (item.transparent !== transparent) item.needsUpdate = true;
    item.transparent = transparent;
    item.depthWrite = data.opacity >= 1;
  }
}

