/**
 * Disposal helpers.
 *
 * three.js does not free GPU resources on its own, so every group that leaves
 * the scene has to be walked and released. These helpers are shared by the
 * stage, the model editor and the asset cache.
 */

/** Release the geometry and materials of a group and mark it as disposed. */
export function disposeGroup(group) {
  group.traverse((object) => {
    object.userData.d3Disposed = true;
    object.geometry?.dispose();
    if (!object.material) return;
    const materials = new Set(
      Array.isArray(object.material) ? object.material : [object.material],
    );
    const sourceMaterials = object.userData.d3SourceMaterial;
    for (const item of Array.isArray(sourceMaterials)
      ? sourceMaterials
      : [sourceMaterials]) {
      if (item) materials.add(item);
    }
    for (const item of materials) item?.dispose();
  });
}

/** Release an imported model template together with the textures it owns. */
export function disposeImportedTemplate(template) {
  const textures = new Set();
  template.traverse((object) => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const item of materials) {
      if (item) {
        for (const value of Object.values(item)) {
          if (value?.isTexture) textures.add(value);
        }
      }
    }
  });
  disposeGroup(template);
  for (const texture of textures) texture.dispose();
}
