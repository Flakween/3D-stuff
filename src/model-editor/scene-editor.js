import { state } from "../state.ts";
import { getSceneEditor, getStage, setSceneEditor } from "../app.ts";

const $ = (selector, root = document) => root.querySelector(selector);
import { save } from "../persistence/save.ts";
import { reconcileScenes, sceneSettings } from "./scenes.js";
import { escapeHTML } from "./thumbnails.js";
import { assetGeneration } from "../renderer/asset-cache.js";
import { fileDataURL, resizedImageDataURL } from "../renderer/textures.js";

export class SceneEditor {
  constructor(panel) {
    this.panel = panel;
    this.root = document.createElement("div");
    this.root.className = "d3-editor d3-scene-editor";
    panel.append(this.root);
    this.category = "sky";
    this.key = "";
    this.root.addEventListener("click", (event) => this.click(event));
    this.root.addEventListener("input", (event) => this.change(event));
    this.root.addEventListener("change", (event) => this.change(event));
    this.sync();
  }
  get target() { return window.vm?.runtime?.getTargetForStage?.(); }
  get index() { return this.target?.currentCostume || 0; }
  sync(force = false) {
    const target = this.target;
    if (!target) return;
    reconcileScenes();
    const key = `${this.index}:${this.category}:${target.getCostumes().map((item) => item.name).join("|")}`;
    if (!force && key === this.key) return;
    this.key = key;
    this.render();
  }
  render() {
    const target = this.target;
    const index = this.index;
    const settings = sceneSettings(index);
    const costumes = target.getCostumes();
    const color = (label, key) => `<label class="d3-scene-field"><span>${label}</span><input type="color" data-scene-property="${key}" value="${settings[key]}"></label>`;
    const range = (label, key, min, max, step) => `<label class="d3-scene-field"><span>${label} <output data-scene-output="${key}">${settings[key]}</output></span><input type="range" data-scene-property="${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}"></label>`;
    const check = (label, key) => `<label class="d3-scene-field d3-scene-check"><span>${label}</span><input type="checkbox" data-scene-property="${key}" ${settings[key] ? "checked" : ""}></label>`;
    const sections = {
      sky: `<h2>Skybox</h2><label class="d3-scene-field"><span>Type</span><select data-scene-property="skyMode"><option value="gradient" ${settings.skyMode === "gradient" ? "selected" : ""}>Sunset gradient</option><option value="color" ${settings.skyMode === "color" ? "selected" : ""}>Solid color</option><option value="texture" ${settings.skyMode === "texture" ? "selected" : ""}>Image texture</option></select></label>${color("Color", "skyColor")}<div class="d3-scene-texture"><span>Texture</span><label class="d3-scene-upload">${settings.skyTexture ? "Replace image" : "+ Add image"}<input type="file" accept="image/png,image/jpeg,image/webp" data-scene-texture></label>${settings.skyTexture ? '<button data-scene-action="remove-texture">Remove</button>' : ""}</div>${settings.skyTexture ? `<img class="d3-scene-preview" src="${settings.skyTexture}" alt="Sky texture preview">` : ""}`,
      fog: `<h2>Fog</h2>${check("Enable fog", "fogEnabled")}${color("Color", "fogColor")}${range("Density", "fogDensity", 0, 0.1, 0.001)}`,
      effects: `<h2>Post Effects</h2>${range("Exposure", "exposure", 0.25, 3, 0.05)}${range("Brightness", "brightness", 0.5, 1.5, 0.01)}${range("Contrast", "contrast", 0.5, 1.5, 0.01)}${range("Saturation", "saturation", 0, 2, 0.01)}`,
      extra: `<h2>Extra</h2>${check("Shadows", "shadows")}${color("Ground color", "groundColor")}${range("Ambient light", "ambient", 0, 4, 0.1)}${range("Sun light", "sun", 0, 6, 0.1)}`,
    };
    this.root.innerHTML = `
      <aside class="d3-assets d3-scene-assets" aria-label="Scenes">
        <div class="d3-scene-list-title">Scenes <span>${costumes.length}</span></div>
        <div class="d3-model-list" role="list" aria-label="Scenes">
          ${costumes.map((costume, i) => `<button role="listitem" data-scene-index="${i}" class="${i === index ? "active" : ""}" aria-label="Scene ${i + 1}: ${escapeHTML(costume.name)}" aria-current="${i === index ? "true" : "false"}" title="${escapeHTML(costume.name)}"><span class="d3-asset-thumb"><span class="d3-asset-index">${i + 1}</span><span class="d3-scene-tile" style="background:${sceneSettings(i).skyColor}">◈</span></span><span class="d3-asset-meta"><span class="d3-asset-name">${escapeHTML(costume.name)}</span></span></button>`).join("")}
        </div>
        <button class="d3-add-fab" data-scene-action="add" title="Duplicate scene" aria-label="Duplicate scene">+</button>
      </aside>
      <main class="d3-workspace">
        <header class="d3-scene-header">
          <label class="d3-scene-name-group"><span>Scene name</span><input class="d3-scene-name" type="text" maxlength="256" aria-label="Scene name" value="${escapeHTML(costumes[index]?.name || "Scene")}"></label>
          <button class="d3-scene-delete" data-scene-action="delete" ${costumes.length <= 1 ? "disabled" : ""} title="Delete scene">Delete scene</button>
        </header>
        <div class="d3-scene-body">
          <nav class="d3-scene-nav" aria-label="Scene settings">${[["sky","Skybox","◩"],["fog","Fog","◌"],["effects","Post Effects","✦"],["extra","Extra","⚙"]].map(([id,label,icon]) => `<button data-scene-category="${id}" class="${this.category === id ? "active" : ""}" aria-current="${this.category === id ? "page" : "false"}"><span aria-hidden="true">${icon}</span>${label}</button>`).join("")}</nav>
          <section class="d3-scene-controls">${sections[this.category]}</section>
        </div>
      </main>`;
  }
  async click(event) {
    const indexButton = event.target.closest("[data-scene-index]");
    if (indexButton) { this.target.setCostume(Number(indexButton.dataset.sceneIndex)); getStage()?.invalidate(); this.sync(true); return; }
    const category = event.target.closest("[data-scene-category]");
    if (category) { this.category = category.dataset.sceneCategory; this.sync(true); return; }
    const action = event.target.closest("[data-scene-action]")?.dataset.sceneAction;
    if (action === "add") {
      const index = this.index;
      const copy = structuredClone(sceneSettings(index));
      try {
        await window.vm.duplicateCostume(index);
        reconcileScenes();
        state.scenes[index + 1].settings = copy;
        save({ recordHistory: false });
        getStage()?.invalidate(); this.sync(true);
      } catch (error) { console.error("Could not duplicate scene", error); }
    } else if (action === "delete" && this.target.getCostumes().length > 1) {
      const index = this.index;
      window.vm.deleteCostume(index);
      state.scenes.splice(index, 1);
      reconcileScenes();
      save({ recordHistory: false }); getStage()?.invalidate(); this.sync(true);
    } else if (action === "remove-texture") {
      sceneSettings(this.index).skyTexture = null;
      if (sceneSettings(this.index).skyMode === "texture") sceneSettings(this.index).skyMode = "gradient";
      save({ recordHistory: false }); getStage()?.invalidate(); this.sync(true);
    }
  }
  async change(event) {
    const input = event.target;
    if (input.classList.contains("d3-scene-name") && event.type === "change") {
      const value = input.value.trim().slice(0, 256) || "Scene";
      window.vm.renameCostume(this.index, value);
      state.scenes[this.index].name = this.target.getCostumes()[this.index].name;
      save({ recordHistory: false }); this.sync(true);
      return;
    }
    if (input.matches("[data-scene-texture]")) {
      if (event.type !== "change" || !input.files?.[0]) return;
      const sceneTarget = this.target;
      const sceneIndex = this.index;
      const settings = sceneSettings(sceneIndex);
      const generation = assetGeneration;
      let bitmap;
      try {
        bitmap = await createImageBitmap(input.files[0], { imageOrientation: "flipY" });
        let dataURL;
        try { dataURL = resizedImageDataURL(bitmap); }
        catch { dataURL = await fileDataURL(input.files[0]); }
        if (
          generation !== assetGeneration ||
          this.target !== sceneTarget ||
          !state.scenes.some((scene) => scene.settings === settings)
        ) return;
        settings.skyTexture = dataURL;
        settings.skyMode = "texture";
        save({ recordHistory: false });
        getStage()?.invalidate();
        if (this.index === sceneIndex) this.sync(true);
      } catch (error) { console.error("Could not load scene texture", error); }
      finally { bitmap?.close?.(); }
      return;
    }
    const key = input.dataset.sceneProperty;
    if (!key) return;
    if (input.tagName === "SELECT" ? event.type !== "change" : event.type !== "input") return;
    const settings = sceneSettings(this.index);
    settings[key] = input.type === "checkbox" ? input.checked : input.type === "range" ? Number(input.value) : input.value;
    const output = $(`[data-scene-output="${key}"]`, this.root);
    if (output) output.textContent = input.value;
    if (key === "skyColor") {
      const tile = $(`.d3-model-list [data-scene-index="${this.index}"] .d3-scene-tile`, this.root);
      if (tile) tile.style.background = input.value;
    }
    if (key === "skyMode") this.sync(true);
    save({ recordHistory: false }); getStage()?.invalidate();
  }
  dispose() {
    this.root.remove();
    if (getSceneEditor() === this) setSceneEditor(null);
  }
}
