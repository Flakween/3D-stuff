import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { editorMarkup, uiIcon } from "./markup.js";
import { WireframeOverlay } from "../ui/wireframe-overlay.js";
import { clamp, normalizeActors, normalizeObject, uid } from "../core/schema.ts";
import { runtime, state } from "../state.ts";
import { actorsByName, flushSave, save, scheduleProjectChanged } from "../persistence/save.ts";
import { actor } from "../runtime/actors.ts";
import { getEditor, getStage, requestRender, setEditor } from "../app.ts";
import { geometry, material } from "../renderer/primitives.js";
import { applyMaps, setMaterialProperties } from "../renderer/materials.js";
import { buildObject } from "../renderer/build.js";
import { disposeGroup } from "../renderer/dispose.js";
import { loadImportedTemplate } from "../renderer/import.js";
import { assetGeneration } from "../renderer/asset-cache.js";
import { makeRenderer, makeScene } from "../renderer/scene.js";
import { matcapTexture } from "../renderer/textures.js";
import {
  bytesToBase64,
  deleteAsset,
  deleteAssetBytes,
  setAssetBytes,
  storeAsset,
} from "../persistence/assets.ts";
import {
  capitalize,
  clearThumbnails,
  escapeHTML,
  modelThumbnail,
  thumbnailEpoch,
  updateThumbnails,
} from "./thumbnails.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const activeModel = () => actor()?.models[actor().active];

export class ModelEditor {
  constructor(panel) {
    this.panel = panel;
    this.root = document.createElement("div");
    this.root.className = "d3-editor";
    panel.append(this.root);
    this.root.innerHTML = editorMarkup(uiIcon);
    this.shapeDefaults = {};
    this.lastShape = "cube";
    this.snap = true;
    this.canvas = $(".d3-canvas", this.root);
    this.renderer = makeRenderer(this.canvas);
    this.renderer.toneMappingExposure = state.exposure;
    this.scene = makeScene(true);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(5, 4.4, 7);
    this.camera.lookAt(0, 1, 0);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.mouseButtons = {
      LEFT: undefined,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.target.set(0, 1, 0);
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.addEventListener("change", requestRender);
    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.nodes = new Map();
    this.selectionHelpers = new Map();
    this.history = [];
    this.historyIndex = -1;
    this.historyTimer = 0;
    this.clipboard = null;
    this.wireframe = false;
    this.wireframeOverlay = new WireframeOverlay();
    this.shadows = true;
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.transformProxy = new THREE.Object3D();
    this.scene.add(this.transformProxy);
    this.gizmos = ["translate", "rotate", "scale"].map((mode, index) => {
      const control = new TransformControls(this.camera, this.canvas);
      control.setMode(mode);
      control.setSize([1, 1.3, .7][index]);
      this.scene.add(control.getHelper());
      control.addEventListener("change", requestRender);
      control.addEventListener("dragging-changed", e => {
        this.controls.enabled = !e.value;
        this.gizmoDragging = e.value;
        if (e.value) {
          this.clickStart = null;
          this.recordHistory(true);
          this.captureTransform();
          for (const other of this.gizmos) if (other !== control) other.enabled = false;
        } else {
          this.persistObjects();
          this.updateGizmo(); this.updateUI();
        }
      });
      control.addEventListener("objectChange", () => {
        this.applyTransform();
        requestRender();
      });
      return control;
    });
    this.gizmo = this.gizmos[0];
    this.touchPointers = new Set();
    this.addTools();
    this.bind();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement);
    this.resize();
    if (!state.selected.length && activeModel()?.objects.length)
      state.selected = [activeModel().objects[0].id];
    this.refresh();
    this.recordHistory(true);
  }
  addTools() {
    const paths = {
      cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 5 8-5M12 12.5V21"/>',
      sphere:
        '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
      cylinder:
        '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 19c0-4 16-4 16 0"/>',
      cone: '<path d="M12 3 4 19c0 3 16 3 16 0z"/><path d="M4 19c0-3 16-3 16 0"/>',
      plane: '<path d="m3 16 7-9 11 1-7 9zM3 16l11 1"/>',
      torus:
        '<ellipse cx="12" cy="12" rx="10" ry="7"/><ellipse cx="12" cy="12" rx="4" ry="2.5"/>',
      star: '<path d="m12 2 2.8 6.7 7.2.6-5.5 4.7 1.7 7-6.2-3.7L5.8 21l1.7-7L2 9.3l7.2-.6z"/>',
    };
    $(".d3-tools", this.root).innerHTML = `
      <button data-tool="select" title="Select" aria-label="Select">${uiIcon("select", 24)}</button>
      <button data-tool="gizmo" title="Transform" aria-label="Transform">${uiIcon("gizmo", 32)}</button>
      <button class="d3-add-mesh" data-action="mesh-menu" title="Shapes" aria-label="Shapes">${uiIcon("shapes", 32)}</button>`;
    $(".d3-shape-grid", this.root).innerHTML = Object.entries(paths).map(([id, path]) =>
      `<button data-tool="${id}" title="${capitalize(id)}"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7">${path}</svg><span>${capitalize(id)}</span></button>`).join("");
  }
  bind() {
    const root = this.root;
    root.addEventListener("click", (e) => {
      const tool = e.target.closest("[data-tool]");
      if (tool) {
        state.tool = tool.dataset.tool;
        if (!["select", "gizmo"].includes(state.tool)) { this.lastShape = state.tool; state.selected = []; }
        this.closePopovers();
        $(".d3-mesh-menu", root).hidden = true;
        this.updateGizmo();
        this.updateUI();
        return;
      }
      const remove = e.target.closest("[data-remove-map]");
      if (remove) {
        const object = this.propertyTarget();
        if (object) { delete object.maps[remove.dataset.removeMap]; if (object.id && this.nodes.has(object.id)) { save({sceneChanged:true, actorName:actor()?.name}); this.refresh(); } else this.updateUI(); }
        return;
      }
      const action = e.target.closest("[data-action]");
      if (action) {
        this.action(action.dataset.action);
        return;
      }
      const pop = e.target.closest("[data-pop]");
      if (pop) {
        this.togglePopover(pop);
        return;
      }
      const model = e.target.closest("[data-model]");
      if (model) {
        const currentActor = actor();
        currentActor.active = Number(model.dataset.model);
        state.selected = [];
        save({ sceneChanged: true, actorName: currentActor.name });
        this.refresh();
        return;
      }
      const tree = e.target.closest("[data-object]");
      if (tree) {
        this.select(tree.dataset.object, e.shiftKey);
        return;
      }
      if (e.target.closest(".d3-hierarchy-toggle")) {
        state.showHierarchy = !state.showHierarchy;
        this.updateUI();
      }
    });
    $(".d3-import", root).addEventListener("change", (e) => {
      if (e.target.files[0]) this.importModel(e.target.files[0]).catch(error => { console.error(error); this.status("This model could not be loaded. Use GLB, embedded glTF, or OBJ."); });
      e.target.value = "";
    });
    root.addEventListener("pointerdown", (e) => {
      if (!e.target.closest(".d3-add-wrap")) $(".d3-add-menu", root).hidden = true;
      if (!e.target.closest(".d3-popup, [data-pop]")) this.closePopovers();
    });
    root.addEventListener("input", (e) => { if (e.target.type !== "number") this.propertyChange(e.target); });
    root.addEventListener("change", (e) => {
      if (e.target.matches(".d3-view-mode")) {
        state.view = e.target.value; this.applyView();
      } else if (e.target.matches(".d3-snap")) { this.snap = e.target.checked;
      } else if (e.target.matches(".d3-transform")) {
        state.transform = e.target.value;
        this.updateGizmo();
        this.updateUI();
      } else if (e.target.matches(".d3-space")) {
        state.space = e.target.value;
        if (state.space === "pivot" && state.transform === "scale") state.transform = "move";
        this.updateGizmo();
        this.updateUI();
      } else if (e.target.matches(".d3-filter")) {
        state.filter = e.target.value;
      } else if (e.target.matches("[data-map]") && e.target.files[0])
        this.importMap(e.target.dataset.map, e.target.files[0]).catch(error => { console.error(error); this.status("This image could not be loaded."); }).finally(() => e.target.value = "");
      else if (e.target.type === "number") this.propertyChange(e.target);
    });
    this.canvas.addEventListener("pointerdown", (e) => this.pointerDown(e), true);
    this.canvas.addEventListener("pointermove", (e) => this.pointerMove(e));
    this.canvas.addEventListener("pointerup", (e) => this.pointerUp(e));
    this.canvas.addEventListener("pointercancel", (e) => this.cancelPointer(e));
    this.onKey = (event) => {
      if (!this.panel.classList.contains("d3-model-active")) return;
      const editingText = event.target?.closest?.(
        "input,textarea,select,[contenteditable='true']",
      );
      if (event.key === "Escape") { this.closePopovers(true); if (!editingText) this.select(null); return; }
      if (editingText) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        this.redo();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        this.deleteSelected();
      }

    };
    window.addEventListener("keydown", this.onKey);
    this.onOutsidePointer = event => { if (!this.root.contains(event.target)) this.closePopovers(); };
    document.addEventListener("pointerdown", this.onOutsidePointer);
  }
  closePopovers(focus = false) {
    $$(".d3-popup", this.root).forEach(item => item.hidden = true);
    $$('[data-pop]', this.root).forEach(button => button.setAttribute("aria-expanded", "false"));
    if (focus) this.popAnchor?.focus();
  }
  togglePopover(button) {
    const item = $(".d3-" + button.dataset.pop, this.root);
    const open = item.hidden;
    this.closePopovers();
    if (!open) return;
    this.popAnchor = button;
    item.hidden = false;
    button.setAttribute("aria-expanded", "true");
    const parent = item.offsetParent.getBoundingClientRect();
    const anchor = button.getBoundingClientRect();
    item.style.left = `${Math.max(4, Math.min(anchor.left - parent.left, parent.width - item.offsetWidth - 4))}px`;
    item.style.right = "auto";
    if (button.dataset.pop !== "view-settings") item.style.top = `${anchor.bottom - parent.top + 8}px`;
  }
  propertyTarget() {
    const selected = this.selectedData();
    if (selected.length === 1) return selected[0];
    if (selected.length || ["select", "gizmo"].includes(state.tool)) return null;
    return this.shapeDefaults[state.tool] ||= normalizeObject({type:state.tool});
  }
  status(message) {
    const el = $(".d3-status", this.root); el.textContent = message; el.hidden = !message;
    clearTimeout(this.statusTimer); this.statusTimer = setTimeout(() => el.hidden = true, 7000);
  }
  recordHistory(immediate = false) {
    clearTimeout(this.historyTimer);
    if (!immediate) {
      this.historyPending = true;
      this.updateHistoryButtons();
      this.historyTimer = setTimeout(() => this.recordHistory(true), 300);
      return;
    }
    this.historyTimer = 0;
    this.historyPending = false;
    const snapshot = JSON.stringify(actorsByName());
    if (this.history[this.historyIndex] !== snapshot) {
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(snapshot);
      if (this.history.length > 40) this.history.shift();
      this.historyIndex = this.history.length - 1;
    }
    this.updateHistoryButtons();
  }
  updateHistoryButtons() {
    const undo = $('[data-action="undo"]', this.root);
    const redo = $('[data-action="redo"]', this.root);
    if (undo) undo.disabled = this.historyIndex <= 0 && !this.historyPending;
    if (redo) redo.disabled = this.historyIndex >= this.history.length - 1;
  }
  applyHistory(index) {
    clearTimeout(this.historyTimer);
    this.historyPending = false;
    const snapshot = this.history[index];
    if (!snapshot) return;
    try {
      state.actors = normalizeActors(JSON.parse(snapshot));
    } catch (error) {
      console.error("Unable to restore the model editor history", error);
      return;
    }
    this.historyIndex = index;
    state.selected = [];
    clearThumbnails();
    flushSave();
    scheduleProjectChanged();
    getStage()?.markDirty();
    this.refresh();
    this.updateHistoryButtons();
  }
  undo() {
    this.recordHistory(true);
    if (this.historyIndex > 0) this.applyHistory(this.historyIndex - 1);
  }
  redo() {
    this.recordHistory(true);
    if (this.historyIndex < this.history.length - 1)
      this.applyHistory(this.historyIndex + 1);
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    if (
      width === this.width &&
      height === this.height &&
      pixelRatio === this.pixelRatio
    )
      return;
    this.width = width;
    this.height = height;
    if (this.pixelRatio !== pixelRatio) this.renderer.setPixelRatio(pixelRatio);
    this.pixelRatio = pixelRatio;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }
  focusModel() {
    const bounds = new THREE.Box3().setFromObject(this.content);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3()),
      size = bounds.getSize(new THREE.Vector3());
    const distance = Math.max(3, size.length() * 1.3);
    this.controls.target.copy(center);
    this.camera.position
      .copy(center)
      .add(
        new THREE.Vector3(0.6, 0.5, 0.8).normalize().multiplyScalar(distance),
      );
    this.controls.update();
    requestRender();
  }
  refresh() {
    const currentActor = actor();
    const model = currentActor?.models[currentActor.active];
    if (!model) return;
    this.wireframeOverlay.clear();
    for (const child of this.content.children) disposeGroup(child);
    this.content.clear();
    this.nodes.clear();
    for (const d of model.objects) {
      const node = buildObject(d);
      this.nodes.set(d.id, node);
    }
    for (const d of model.objects) {
      (this.nodes.get(d.parent) || this.content).add(this.nodes.get(d.id));
    }
    state.selected = state.selected.filter((id) => this.nodes.has(id));
    this.updateGizmo();
    if (state.view !== "rendered") this.applyView();
    else {
      this.applyWireframe();
      this.updateUI();
    }
    requestRender();
    getStage()?.markDirty(currentActor.name);
    updateThumbnails();
  }
  invalidate() {
    requestRender();
  }
  render() {
    this.controls.update();
    for (const helper of this.selectionHelpers.values()) helper.update();
    this.renderer.render(this.scene, this.camera);
  }
  updateUI() {
    const currentActor = actor();
    const model = activeModel();
    if (!currentActor || !model) return;
    const selecting = state.tool === "select";
    $(".d3-name-group", this.root).hidden = !selecting;
    $(".d3-topbar", this.root).classList.toggle("d3-compact-tools", !selecting);
    $(".d3-model-name", this.root).value = model.name;
    const listKey = `${currentActor.active}:${runtime.actorRevisions.get(currentActor.name) || 0}:${thumbnailEpoch}`;
    if (this.modelListActor !== currentActor || this.modelListKey !== listKey) {
      this.modelListActor = currentActor;
      this.modelListKey = listKey;
      $(".d3-model-list", this.root).innerHTML = currentActor.models
        .map((item, index) => {
          const src = modelThumbnail(item, currentActor.name);
          return `<button role="listitem" data-model="${index}" class="${currentActor.active === index ? "active" : ""}" title="${escapeHTML(item.name)}"><span class="d3-asset-thumb"><span class="d3-asset-index">${index + 1}</span><img src="${src}" alt=""></span><span class="d3-asset-meta"><span class="d3-asset-name">${escapeHTML(item.name)}</span><span class="d3-asset-size">${item.objects.length} ${item.objects.length === 1 ? "mesh" : "meshes"}</span></span></button>`;
        })
        .join("");
    }

    const selected = this.selectedData();
    const one = this.propertyTarget();
    const actual = selected.length === 1 ? selected[0] : null;
    $(".d3-object-name", this.root).value = actual?.name || "";
    $(".d3-object-name", this.root).disabled = !actual;
    $(".d3-color-swatch", this.root).style.backgroundColor =
      one?.color || "#ffffff";
    $("[data-action='paste']", this.root).disabled = !this.clipboard?.length;
    $(".d3-selection-count", this.root).textContent = one
      ? one.type === "import"
        ? "Imported model"
        : capitalize(one.type)
      : selected.length
        ? `${selected.length} objects selected`
        : "No selection";

    for (const [className, value] of [
      ["color", one?.color || "#ffffff"],
      ["metallic", one?.metallic ?? 0],
      ["smoothness", one?.smoothness ?? 0.5],
      ["opacity", one?.opacity ?? 1],
      ["subdiv", one?.subdivisions || 1],
      ["points", one?.points || 5],
      ["inner", one?.innerAngle ?? 120],
    ]) {
      const input = $(".d3-" + className, this.root);
      if (input) input.value = value;
    }
    $(".d3-color-hex", this.root).value = one?.color || "#ffffff";
    for (const input of $$(".d3-color", this.root)) input.value = one?.color || "#ffffff";
    $(".d3-linear", this.root).checked = !!one?.linear;
    for (const input of $$(".d3-color-panel input, .d3-maps input", this.root)) input.disabled = !one;
    for (const selector of [
      "[data-requires-one]",
      "[data-requires-selection]",
    ]) {
      for (const control of $$(selector, this.root)) {
        const disabled =
          selector === "[data-requires-one]" ? !one : selected.length === 0;
        const controls = control.matches("input,button,select")
          ? [control]
          : $$("input,button,select", control);
        for (const item of controls) item.disabled = disabled;
      }
    }
    for (const field of $$(".d3-transform-field", this.root)) {
      const property = field.dataset.transform;
      const axis = Number(field.dataset.axis);
      const node = this.nodes.get(actual?.id);
      const raw = this.inspectorValues(node, property)?.[axis];
      const value = property === "rotation" ? (raw * 180) / Math.PI : raw;
      field.value = Number.isFinite(value)
        ? String(Number(value.toFixed(3)))
        : "";
      field.disabled = !actual || (state.space === "pivot" && property === "scale");
    }
    for (const item of $$(".d3-star-only", this.root)) {
      item.hidden = one?.type !== "star";
    }

    $(".d3-transform", this.root).value = state.transform;
    $(".d3-transform option[value='scale']", this.root).disabled = state.space === "pivot";
    $(".d3-transform-tools", this.root).hidden = state.tool !== "gizmo";
    $(".d3-shape-options", this.root).hidden = ["select", "gizmo"].includes(state.tool);
    $("[data-pop='mesh-menu']", this.root).innerHTML = `${capitalize(this.lastShape)}<span class="d3-caret"></span>`;
    for (const field of $$(".d3-toolbar-second > .d3-field-block", this.root)) field.hidden = !one;
    $(".d3-geometry-options", this.root).hidden = !one || one.type === "import";
    $(".d3-view-mode", this.root).value = state.view;
    $(".d3-exposure-row", this.root).hidden = state.view !== "rendered";
    $("[data-action='shadows']", this.root).hidden = state.view !== "rendered";
    for (const output of $$('[data-output]', this.root)) output.value = `${Math.round((one?.[output.dataset.output] ?? 0) * 100)}%`;
    for (const img of $$('[data-preview]', this.root)) {
      const key = img.dataset.preview, url = one?.maps?.[key];
      img.hidden = !url; if (url) img.src = url; else img.removeAttribute('src');
      $(`[data-placeholder="${key}"]`, this.root).hidden = !!url;
      $(`[data-map-name="${key}"]`, this.root).textContent = url ? 'Replace texture' : 'Upload texture';
      $(`[data-remove-map="${key}"]`, this.root).disabled = !url;
    }
    $(".d3-material-swatch", this.root).style.backgroundImage = one?.maps?.texture ? `url("${one.maps.texture}")` : "none";
    $(".d3-space", this.root).value = state.space;
    $(".d3-filter", this.root).value = state.filter;
    $(".d3-exposure", this.root).value = state.exposure;
    $("[data-action='grid']", this.root).classList.toggle("active", state.grid);
    $("[data-action='wireframe']", this.root).classList.toggle("active", this.wireframe);
    $("[data-action='shadows']", this.root).classList.toggle("active", this.shadows);
    $(".d3-hierarchy-toggle", this.root).classList.toggle("active", state.showHierarchy);
    const gridHelper = this.scene.children.find(
      (object) => object.isGridHelper,
    );
    if (gridHelper) gridHelper.visible = state.grid;
    const chainButton = $(".d3-chain", this.root);
    chainButton.hidden = false;
    chainButton.disabled = selected.length < 2;
    for (const button of $$('[data-action="parent"]', this.root)) {
      button.disabled = selected.length < 2;
    }
    $(".d3-selection-extra", this.root).hidden = state.tool !== "select";
    $(".d3-box-toggle", this.root).classList.toggle("active", state.boxSelect);
    $(".d3-box-toggle", this.root).setAttribute("aria-pressed", String(state.boxSelect));
    for (const button of $$("[data-tool]", this.root)) {
      button.classList.toggle("active", button.dataset.tool === state.tool);
    }
    $(".d3-add-mesh", this.root).classList.toggle("active", !["select", "gizmo"].includes(state.tool));
    for (const action of ["grid", "wireframe", "shadows"]) {
      $("[data-action='" + action + "']", this.root).setAttribute("aria-pressed", String(action === "grid" ? state.grid : action === "wireframe" ? this.wireframe : this.shadows));
    }
    $(".d3-hierarchy-toggle", this.root).setAttribute("aria-pressed", String(state.showHierarchy));
    $(".d3-hierarchy", this.root).hidden = !state.showHierarchy;
    this.renderHierarchy();
    this.updateSelectionHelpers();
    this.updateHistoryButtons();
    this.canvas.style.cursor = ["select", "gizmo"].includes(state.tool)
      ? "default"
      : "crosshair";
    this.invalidate();
  }
  updateSelectionHelpers() {
    for (const helper of this.selectionHelpers.values()) { this.scene.remove(helper); helper.geometry.dispose(); helper.material.dispose(); }
    this.selectionHelpers.clear();
    for (const id of state.selected) {
      const node = this.nodes.get(id); if (!node) continue;
      const helper = new THREE.BoxHelper(node, id === state.selected.at(-1) ? 0xff7777 : 0xffbcbc);
      helper.material.depthTest = false; helper.renderOrder = 10;
      this.scene.add(helper); this.selectionHelpers.set(id,helper);
    }
  }
  renderHierarchy() {
    const model = activeModel();
    if (!model) return;
    const byParent = new Map();
    for (const d of model.objects) {
      const key = d.parent || "root";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(d);
    }
    const walk = (p, depth = 0) =>
      depth > 30
        ? ""
        : (byParent.get(p) || [])
            .map(
              (d) =>
                `<button data-object="${escapeHTML(d.id)}" class="${state.selected.includes(d.id) ? "selected" : ""}" style="padding-left:${8 + depth * 13}px"><span>${escapeHTML(d.name)}</span></button>${walk(d.id, depth + 1)}`,
            )
            .join("");
    $(".d3-hierarchy-items", this.root).innerHTML =
      walk("root") || '<span class="d3-empty-tree">Empty model</span>';
  }
  selectedData() {
    return (
      activeModel()?.objects.filter((d) => state.selected.includes(d.id)) || []
    );
  }
  select(id, add = false) {
    if (!id) state.selected = [];
    else if (add) {
      if (state.selected.includes(id))
        state.selected = state.selected.filter((x) => x !== id);
      else state.selected.push(id);
    } else state.selected = [id];
    this.updateGizmo();
    this.updateUI();
    requestRender();
  }
  selectedRoots() {
    return state.selected.map(id => this.nodes.get(id)).filter(node => {
      if (!node) return false;
      for (let p = node.parent; p; p = p.parent) if (state.selected.includes(p.userData.objectId)) return false;
      return true;
    });
  }
  inspectorValues(node, property) {
    if (!node) return null;
    if (state.space !== "world") return property === "rotation" ? [node.rotation.x,node.rotation.y,node.rotation.z] : node[property].toArray();
    node.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3();
    node.matrixWorld.decompose(p,q,scale);
    if (property === "rotation") { const e = new THREE.Euler().setFromQuaternion(q); return [e.x,e.y,e.z]; }
    return (property === "position" ? p : scale).toArray();
  }
  updateGizmo() {
    this.invalidate();
    for (const control of this.gizmos) { control.detach(); control.enabled = false; }
    const node = this.nodes.get(state.selected.at(-1));
    if (!node || state.tool !== "gizmo") return;
    this.content.updateMatrixWorld(true);
    this.transformProxy.scale.set(1,1,1);
    if (state.space === "world") {
      const bounds = new THREE.Box3();
      for (const root of this.selectedRoots()) bounds.expandByObject(root);
      if (bounds.isEmpty()) node.getWorldPosition(this.transformProxy.position);
      else bounds.getCenter(this.transformProxy.position);
      this.transformProxy.quaternion.identity();
    } else {
      node.getWorldPosition(this.transformProxy.position);
      node.getWorldQuaternion(this.transformProxy.quaternion);
    }
    this.transformProxy.updateMatrixWorld(true);
    for (const control of this.gizmos) {
      const wanted = state.transform === "all" || control.mode === ({move:"translate",rotate:"rotate",scale:"scale"}[state.transform]);
      if (!wanted || (state.space === "pivot" && control.mode === "scale")) continue;
      control.enabled = true;
      control.setSpace(state.space === "world" ? "world" : "local");
      control.attach(this.transformProxy);
    }
  }
  captureTransform() {
    this.content.updateMatrixWorld(true);
    this.transformProxy.updateMatrixWorld(true);
    this.transformStart = this.transformProxy.matrixWorld.clone().invert();
    this.transformNodes = this.selectedRoots().map(node => ({ node, world: node.matrixWorld.clone(), children: node.children.map(child => ({child, world:child.matrixWorld.clone()})) }));
  }
  applyTransform() {
    if (!this.transformStart || !this.transformNodes) return;
    this.transformProxy.updateMatrixWorld(true);
    const delta = this.transformProxy.matrixWorld.clone().multiply(this.transformStart);
    for (const {node, world, children} of this.transformNodes) {
      node.parent.updateWorldMatrix(true, false);
      const local = node.parent.matrixWorld.clone().invert().multiply(delta).multiply(world);
      local.decompose(node.position, node.quaternion, node.scale);
      node.updateMatrixWorld(true);
      if (state.space === "pivot") {
        const inv = node.matrixWorld.clone().invert();
        for (const {child, world:original} of children) inv.clone().multiply(original).decompose(child.position, child.quaternion, child.scale);
      }
    }
    this.persistObjects(false);
  }
  persistObjects(full = true) {
    const model = activeModel();
    if (!model) return;
    for (const d of model.objects) {
      const node = this.nodes.get(d.id);
      if (!node) continue;
      d.parent = node.parent?.userData.objectId || null;
      d.position = node.position.toArray();
      d.rotation = [node.rotation.x, node.rotation.y, node.rotation.z];
      d.scale = node.scale.toArray();
      const mesh = node.children.find((c) => c.isMesh || c.userData.d3ModelContent);
      if (mesh) {
        d.meshPosition = mesh.position.toArray();
        d.meshRotation = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z];
        d.meshScale = mesh.scale.toArray();
      }
    }
    const saveOptions = {
      actorName: actor()?.name,
      recordHistory: !this.gizmoDragging,
    };
    if (full) {
      save(saveOptions);
      getStage()?.sync();
      updateThumbnails();
      this.renderHierarchy();
    } else save(saveOptions);
  }
  screenPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.pointer, this.camera);
    return r;
  }
  floorPoint(e) {
    this.screenPoint(e);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.floor, p) ? p : null;
  }
  hit(e) {
    this.screenPoint(e);
    const meshes = [];
    this.content.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    const objectsById = new Map(
      (activeModel()?.objects || []).map((object) => [object.id, object]),
    );
    for (const hit of this.ray.intersectObjects(meshes, false)) {
      const id = this.parentId(hit.object);
      const data = objectsById.get(id);
      if (data && (state.filter === "all" || state.filter === data.type)) return id;
    }
    return null;
  }
  cancelPointer(e) {
    this.touchPointers.delete(e.pointerId);
    if (this.drag?.kind === "draw") {
      const model = activeModel();
      model.objects = model.objects.filter(d => d.id !== this.drag.d.id);
      state.selected = [];
      this.refresh();
    }
    this.drag = null; this.clickStart = null;
    $(".d3-box", this.root).hidden = true;
    this.controls.enabled = true;
    this.controls.enableRotate = true;
  }
  pointerDown(e) {
    if (e.pointerType === "touch") {
      this.touchPointers.add(e.pointerId);
      if (this.touchPointers.size > 1) { this.cancelPointer({pointerId: -1}); this.controls.enableRotate = true; return; }
    }
    if (e.button !== 0 || e.isPrimary === false) return;
    this.controls.enableRotate = true;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    const navigating = ["select", "gizmo"].includes(state.tool);
    if (navigating) {
      if (state.tool === "gizmo" && this.gizmos.some(g => g.enabled && g.axis)) return;
      if (state.tool === "select" && state.boxSelect) {
        this.drag = {kind:"box", x:e.clientX, y:e.clientY, add:e.shiftKey};
        this.controls.enabled = e.pointerType === "touch";
        this.controls.enableRotate = false;
        this.canvas.setPointerCapture(e.pointerId);
      } else {
        this.clickStart = {x:e.clientX, y:e.clientY, id:this.hit(e), shift:e.shiftKey};
      }
      return;
    }
    const start = this.floorPoint(e);
    if (!start) return;
    if (this.snap) { start.x = Math.round(start.x * 4) / 4; start.z = Math.round(start.z * 4) / 4; }
    const defaults = this.shapeDefaults[state.tool] ||= normalizeObject({type:state.tool});
    const d = normalizeObject({...JSON.parse(JSON.stringify(defaults)), id:uid(), type:state.tool, name:capitalize(state.tool), position:[start.x, .125, start.z], width:.25, depth:.25, height:.25});
    this.recordHistory(true);
    activeModel().objects.push(d);
    this.drag = {kind:"draw", start, d};
    this.controls.enabled = e.pointerType === "touch";
    this.controls.enableRotate = false;
    this.canvas.setPointerCapture(e.pointerId);
    state.selected = [d.id];
    this.refresh();
    const node = this.nodes.get(d.id), mesh = node.children.find(c=>c.isMesh);
    mesh.geometry.computeBoundingBox();
    d.position[1] = d.type === "plane" ? .002 : -mesh.geometry.boundingBox.min.y;
    node.position.y = d.position[1];
  }
  pointerMove(e) {
    if (this.touchPointers.size > 1 || !this.drag) return;
    if (this.drag.kind === "box") {
      const r = this.canvas.getBoundingClientRect(),
        box = $(".d3-box", this.root);
      box.hidden = false;
      const x = Math.min(e.clientX, this.drag.x) - r.left,
        y = Math.min(e.clientY, this.drag.y) - r.top;
      box.style.cssText = `left:${x}px;top:${y}px;width:${Math.abs(e.clientX - this.drag.x)}px;height:${Math.abs(e.clientY - this.drag.y)}px`;
      return;
    }
    const end = this.floorPoint(e),
      { start, d } = this.drag;
    if (!end) return;
    if (this.snap) { end.x = Math.round(end.x * 4) / 4; end.z = Math.round(end.z * 4) / 4; }
    const w = Math.max(this.snap ? .25 : .05, Math.abs(end.x - start.x)),
      z = Math.max(this.snap ? .25 : .05, Math.abs(end.z - start.z));
    d.width = w;
    d.depth = z;
    d.height = d.type === "plane" ? 0.025 : Math.max(0.25, Math.min(w, z));
    d.position = [(start.x + end.x) / 2, d.height / 2, (start.z + end.z) / 2];
    const node = this.nodes.get(d.id);
    if (node) {
      node.position.fromArray(d.position);
      const mesh = node.children.find((c) => c.isMesh || c.userData.d3ModelContent);
      if (mesh) {
        mesh.geometry.dispose();
        mesh.geometry = geometry(d);
        mesh.geometry.computeBoundingBox();
        d.position[1] = d.type === "plane" ? .002 : -mesh.geometry.boundingBox.min.y;
        node.position.y = d.position[1];
      }
    }
    requestRender();
  }
  pointerUp(e) {
    this.touchPointers.delete(e.pointerId);
    if (this.clickStart) {
      const click = this.clickStart; this.clickStart = null;
      if (!this.gizmoDragging && Math.hypot(e.clientX-click.x,e.clientY-click.y) < 5) this.select(click.id,click.shift);
    }
    if (!this.drag) return;
    if (this.drag.kind === "box") {
      const p = this.drag,
        r = this.canvas.getBoundingClientRect();
      const minX = Math.min(p.x, e.clientX) - r.left,
        maxX = Math.max(p.x, e.clientX) - r.left,
        minY = Math.min(p.y, e.clientY) - r.top,
        maxY = Math.max(p.y, e.clientY) - r.top;
      if (!p.add) state.selected = [];
      for (const d of activeModel().objects) {
        if (state.filter !== "all" && state.filter !== d.type) continue;
        const node = this.nodes.get(d.id);
        node.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(node);
        if (bounds.isEmpty()) continue;
        const projected = [];
        for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) projected.push(new THREE.Vector3(x,y,z).project(this.camera));
        if (!projected.some(p=>p.z>=-1 && p.z<=1)) continue;
        const xs=projected.map(p=>(p.x+1)*r.width/2), ys=projected.map(p=>(1-p.y)*r.height/2);
        if (Math.max(...xs)>=minX && Math.min(...xs)<=maxX && Math.max(...ys)>=minY && Math.min(...ys)<=maxY && !state.selected.includes(d.id)) state.selected.push(d.id);
      }
      $(".d3-box", this.root).hidden = true;
      this.updateGizmo();
      this.updateUI();
    } else {
      this.persistObjects();
      this.refresh();
    }
    this.drag = null;
    this.controls.enabled = true;
    this.controls.enableRotate = true;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {}
  }
  async action(which) {
    if (which === "add-menu") {
      const menu = $(".d3-add-menu", this.root);
      menu.hidden = !menu.hidden;
    } else if (which === "mesh-menu") {
      const one = this.selectedData()[0];
      if (one && ["cube","sphere","cone","cylinder","plane","torus","star"].includes(one.type)) this.lastShape = one.type;
      else state.selected = [];
      state.tool = this.lastShape; this.closePopovers(); this.updateGizmo(); this.updateUI();
    } else if (which === "close-pop") {
      this.closePopovers(true);
    } else if (which === "subdiv-up" || which === "subdiv-down") {
      const input = $(".d3-subdiv", this.root);
      input.value = clamp((Number(input.value) || 1) * (which === "subdiv-up" ? 2 : .5), 1, 16);
      this.propertyChange(input);
    } else if (which === "copy") {
      this.clipboard = this.selectedData().map((object) => JSON.parse(JSON.stringify(object)));
      this.updateUI();
    } else if (which === "paste") {
      const model = activeModel();
      if (!model || !this.clipboard?.length) return;
      const ids = new Map(this.clipboard.map((object) => [object.id, uid()]));
      const copies = this.clipboard.map((object) => {
        const copy = normalizeObject(JSON.parse(JSON.stringify(object)));
        copy.id = ids.get(object.id);
        copy.name = `${object.name} copy`;
        copy.parent = ids.get(object.parent) || null;
        copy.position = [object.position[0] + .25, object.position[1], object.position[2] + .25];
        return copy;
      });
      model.objects.push(...copies);
      state.selected = copies.map((object) => object.id);
      save({ sceneChanged: true, actorName: actor()?.name });
      this.refresh();
    } else if (which === "grid") {
      state.grid = !state.grid;
      const helper = this.scene.children.find((object) => object.isGridHelper);
      if (helper) helper.visible = state.grid;
      this.updateUI();
      requestRender();
    } else if (which === "wireframe") {
      this.wireframe = !this.wireframe;
      this.applyView();
    } else if (which === "shadows") {
      this.shadows = !this.shadows;
      this.renderer.shadowMap.enabled = this.shadows;
      this.scene.traverse((object) => {
        if (object.isMesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (material) material.needsUpdate = true;
        }
      });
      this.updateUI();
      requestRender();
    } else if (which === "zoom-in" || which === "zoom-out") {
      const scale = which === "zoom-in" ? .8 : 1.25;
      this.camera.position.sub(this.controls.target).multiplyScalar(scale).add(this.controls.target);
      this.controls.update();
      requestRender();
    } else if (which === "zoom-reset") {
      this.focusModel();
    } else if (which === "export") {
      const exportRoot = new THREE.Group();
      try {
        const objects = activeModel().objects;
        await Promise.all(objects.filter(d=>d.type === "import").map(d=>loadImportedTemplate(d)));
        const nodes = new Map(objects.map(d=>[d.id, buildObject(d)]));
        for (const d of objects) (nodes.get(d.parent) || exportRoot).add(nodes.get(d.id));
        const result = await new GLTFExporter().parseAsync(exportRoot, { binary: true, onlyVisible: false });
        const url = URL.createObjectURL(new Blob([result], { type: "model/gltf-binary" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${(activeModel()?.name || "model").replace(/[^a-z0-9_-]+/gi, "_")}.glb`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        console.error("Unable to export model", error);
        this.status("Could not export this model. Try again after its assets finish loading.");
      } finally { disposeGroup(exportRoot); }
    } else if (which === "empty") {
      $(".d3-add-menu", this.root).hidden = true;
      const currentActor = actor();
      currentActor.models.push({
        id: uid(),
        name: `model${currentActor.models.length + 1}`,
        objects: [],
      });
      currentActor.active = currentActor.models.length - 1;
      state.selected = [];
      save({ sceneChanged: true, actorName: currentActor.name });
      this.refresh();
    } else if (which === "import") {
      $(".d3-add-menu", this.root).hidden = true;
      $(".d3-import", this.root).click();
    } else if (which === "box") {
      state.boxSelect = !state.boxSelect;
      this.updateUI();
    } else if (which === "undo") {
      this.undo();
    } else if (which === "redo") {
      this.redo();
    } else if (which === "duplicate") {
      this.duplicateSelected();
    } else if (which === "delete") {
      this.deleteSelected();
    } else if (which === "parent" || which === "chain") {
      this.parent(which === "chain");
    }
  }
  duplicateSelected() {
    const model = activeModel();
    if (!model || !state.selected.length) return;
    const selected = new Set(state.selected);
    const originals = model.objects.filter((object) => selected.has(object.id));
    const idMap = new Map(originals.map((object) => [object.id, uid()]));
    const copies = originals.map((object) => {
      const copy = normalizeObject(JSON.parse(JSON.stringify(object)));
      copy.id = idMap.get(object.id);
      copy.name = `${object.name} copy`;
      copy.parent = selected.has(object.parent)
        ? idMap.get(object.parent)
        : object.parent;
      copy.position = [
        object.position[0] + 0.25,
        object.position[1],
        object.position[2] + 0.25,
      ];
      return copy;
    });
    model.objects.push(...copies);
    state.selected = copies.map((object) => object.id);
    save({ sceneChanged: true, actorName: actor()?.name });
    this.refresh();
  }
  parent(chain) {
    if (state.selected.length < 2) return;
    const ids = state.selected.slice();
    for (const id of ids) this.content.attach(this.nodes.get(id));
    if (chain) {
      let parent = this.nodes.get(ids.at(-1));
      for (let i = ids.length - 2; i >= 0; i--) {
        const child = this.nodes.get(ids[i]);
        parent.attach(child);
        parent = child;
      }
    } else {
      const parent = this.nodes.get(ids.at(-1));
      for (const id of ids.slice(0, -1)) parent.attach(this.nodes.get(id));
    }
    this.persistObjects();
    this.refresh();
  }
  deleteSelected() {
    const model = activeModel();
    if (!model || !state.selected.length) return;
    for (const id of state.selected) {
      const node = this.nodes.get(id);
      if (node)
        for (const child of [...node.children])
          if (child.userData.objectId) this.content.attach(child);
    }
    this.persistObjects(false);
    model.objects = model.objects.filter((d) => !state.selected.includes(d.id));
    state.selected = [];
    save({ sceneChanged: true, actorName: actor()?.name });
    this.refresh();
  }
  propertyChange(el) {
    if (el.classList.contains("d3-model-name")) {
      const currentActor = actor();
      const model = activeModel();
      if (model) {
        model.name = el.value;
        save({ actorName: currentActor?.name });
        const row = $(
          `.d3-model-list [data-model="${currentActor?.active}"]`,
          this.root,
        );
        if (row) {
          row.title = model.name;
          $(".d3-asset-name", row).textContent = model.name;
        }
      }
      return;
    }
    if (el.classList.contains("d3-background")) { this.scene.background = new THREE.Color(el.value); requestRender(); return; }
    if (el.classList.contains("d3-exposure")) {
      state.exposure = Number(el.value);
      this.renderer.toneMappingExposure = state.exposure;

      requestRender();
      return;
    }
    if (el.classList.contains("d3-grid")) {
      state.grid = el.checked;
      const helper = this.scene.children.find((o) => o.isGridHelper);
      if (helper) helper.visible = state.grid;
      requestRender();
      return;
    }
    if (el.matches(".d3-transform-field")) {
      const selected = this.selectedData();
      if (selected.length !== 1) return;
      const one = selected[0];
      const value = Number(el.value);
      if (!Number.isFinite(value)) return;
      const property = el.dataset.transform;
      const axis = Number(el.dataset.axis);
      if (state.space === "pivot" && property === "scale") return;
      const node = this.nodes.get(one.id);
      node.updateWorldMatrix(true, true);
      const children = node.children.map(child => ({child, world: child.matrixWorld.clone()}));
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      (state.space === "world" ? node.matrixWorld : node.matrix).decompose(p,q,sc);
      const rotation = new THREE.Euler().setFromQuaternion(q);
      const vector = property === "position" ? p : property === "scale" ? sc : rotation;
      vector[["x","y","z"][axis]] = property === "rotation" ? THREE.MathUtils.degToRad(value) : value;
      if (property === "rotation") q.setFromEuler(rotation);
      if (Math.abs(sc.x * sc.y * sc.z) < 1e-8) return;
      const matrix = new THREE.Matrix4().compose(p,q,sc);
      if (state.space === "world") matrix.premultiply(node.parent.matrixWorld.clone().invert());
      matrix.decompose(node.position,node.quaternion,node.scale);
      node.updateMatrixWorld(true);
      if (state.space === "pivot") for (const {child,world} of children) node.matrixWorld.clone().invert().multiply(world).decompose(child.position,child.quaternion,child.scale);
      this.persistObjects();
      this.updateGizmo();
      requestRender();
      return;
    }
    const one = this.propertyTarget();
    if (!one) return;
    const map = {
      "d3-object-name": "name",
      "d3-color": "color",
      "d3-color-hex": "color",
      "d3-metallic": "metallic",
      "d3-smoothness": "smoothness",
      "d3-opacity": "opacity",
      "d3-subdiv": "subdivisions",
      "d3-linear": "linear",
      "d3-points": "points",
      "d3-inner": "innerAngle",
    };
    let key;
    for (const [cls, k] of Object.entries(map))
      if (el.classList.contains(cls)) key = k;
    if (!key) return;
    if (
      key === "color" &&
      el.classList.contains("d3-color-hex") &&
      !/^#[0-9a-f]{6}$/i.test(el.value)
    )
      return;
    one[key] =
      el.type === "checkbox"
        ? el.checked
        : el.type === "number" || el.type === "range"
          ? Number(el.value)
          : el.value;
    if (key === "subdivisions") one[key] = 2 ** Math.ceil(Math.log2(clamp(one[key] || 1, 1, 16)));
    if (key === "points") one[key] = clamp(Math.round(one[key]), 3, 24);
    if (key === "innerAngle") one[key] = clamp(one[key], 30, 175);
    if (["metallic", "smoothness", "opacity"].includes(key)) { one[key] = clamp(one[key], 0, 1); $("[data-output=" + key + "]", this.root).value = `${Math.round(one[key] * 100)}%`; }
    if (!["select", "gizmo"].includes(state.tool)) this.shapeDefaults[state.tool] = normalizeObject({...JSON.parse(JSON.stringify(one)), id:uid(), parent:null, position:[0,0,0], rotation:[0,0,0], scale:[1,1,1], meshPosition:[0,0,0], meshRotation:[0,0,0], meshScale:[1,1,1]});
    if (!this.nodes.has(one.id)) { this.updateUI(); return; }
    if (
      one.type === "import" &&
      ["color", "metallic", "smoothness", "opacity"].includes(key)
    ) {
      one.materialOverride = true;
    }
    save({ actorName: actor()?.name });
    if (key === "color") {
      $(".d3-color-swatch", this.root).style.backgroundColor = one.color;
      $(".d3-color-hex", this.root).value = one.color;
      for (const input of $$(".d3-color", this.root)) input.value = one.color;
    }
    if (key === "name") this.nodes.get(one.id).name = one.name;
    else if (
      key === "color" ||
      key === "metallic" ||
      key === "smoothness" ||
      key === "opacity"
    ) {
      this.nodes.get(one.id).traverse((object) => {
        if (!object.isMesh || object.userData.d3WireframeOverlay || !object.material || this.parentId(object) !== one.id) return;
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const item of materials) {
          item.color?.set(one.color);
          if ("metalness" in item) item.metalness = one.metallic;
          if ("roughness" in item) item.roughness = 1 - one.smoothness;
          item.opacity = one.opacity;
          item.transparent = one.opacity < 1 || !!one.maps.opacity;
          item.depthWrite = one.opacity >= 1;
          item.needsUpdate = true;
        }
      });
    } else if (key !== "name") this.refresh();
    this.renderHierarchy();
    getStage()?.sync();
    updateThumbnails();
    requestRender();
  }
  applyView() {
    this.wireframeOverlay.clear();
    const model = activeModel();
    if (!model) return;
    const objectsById = new Map(model.objects.map(object => [object.id, object]));
    this.content.traverse((object) => {
      if (!object.isMesh) return;
      const data = objectsById.get(this.parentId(object));
      if (!data) return;
      const sourceMaterial = object.userData.d3SourceMaterial;
      const sourceMaterials = Array.isArray(sourceMaterial)
        ? sourceMaterial
        : sourceMaterial
          ? [sourceMaterial]
          : [];
      const preserveImported =
        data.type === "import" && sourceMaterials.length > 0;
      const currentMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];

      if (state.view === "rendered" && preserveImported) {
        for (const item of currentMaterials) {
          if (item && !sourceMaterials.includes(item)) item.dispose();
        }
        object.material = sourceMaterial;
        if (data.materialOverride) setMaterialProperties(object, data);
        applyMaps(object, data);
        return;
      }

      for (const item of currentMaterials) {
        if (item && !sourceMaterials.includes(item)) item.dispose();
      }
      if (state.view === "unlit") {
        const basicMaterial = (source) =>
          new THREE.MeshBasicMaterial({
            color: preserveImported && !data.materialOverride ? source?.color || data.color : data.color,
            map: preserveImported ? source?.map || null : null,
            transparent: data.opacity < 1,
            opacity: data.opacity,
            depthWrite: data.opacity >= 1,
            side: THREE.DoubleSide,
          });
        object.material =
          preserveImported && Array.isArray(sourceMaterial)
            ? sourceMaterials.map(basicMaterial)
            : basicMaterial(sourceMaterials[0]);
        applyMaps(object, data);
      } else if (state.view === "madcap") {
        const matcapMaterial = (source) =>
          new THREE.MeshMatcapMaterial({
            matcap: matcapTexture,
            color: this.wireframe ? (preserveImported && !data.materialOverride ? source?.color || data.color : data.color) : 0xffffff,
            map: this.wireframe && preserveImported ? source?.map || null : null,
            transparent: data.opacity < 1,
            opacity: data.opacity,
            depthWrite: data.opacity >= 1,
            side: THREE.DoubleSide,
          });
        object.material =
          preserveImported && Array.isArray(sourceMaterial)
            ? sourceMaterials.map(matcapMaterial)
            : matcapMaterial(sourceMaterials[0]);
        if (this.wireframe) applyMaps(object, data);
      } else {
        object.material = material(data);
        applyMaps(object, data);
      }
    });
    this.applyWireframe();
    this.updateUI();
    requestRender();
  }
  applyWireframe() {
    this.wireframeOverlay.update(this.content, this.wireframe);
  }
  parentId(o) {
    while (o && !o.userData.objectId) o = o.parent;
    return o?.userData.objectId;
  }
  async importModel(file) {
    const currentActor = actor();
    if (!currentActor) return;
    const generation = assetGeneration;
    const format = file.name.toLowerCase().endsWith(".obj")
      ? "obj"
      : file.name.toLowerCase().endsWith(".glb")
        ? "glb"
        : "gltf";
    const assetId = uid();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (generation !== assetGeneration) return;
    let source = { format, assetId };
    try {
      await storeAsset(assetId, new Blob([bytes], { type: file.type }));
      setAssetBytes(assetId, bytes);
    } catch {
      source = { format, assetId, data: bytesToBase64(bytes) };
    }
    if (generation !== assetGeneration) {
      deleteAssetBytes(assetId);
      try { await deleteAsset(assetId); } catch {}
      return;
    }
    const d = normalizeObject({ type: "import", name: file.name, source });
    try {
      await loadImportedTemplate(d);
    } catch (error) {
      deleteAssetBytes(assetId);
      try { await deleteAsset(assetId); } catch {}
      throw error;
    }
    if (generation !== assetGeneration || !Object.values(state.actors).includes(currentActor)) return;
    const model = {
      id: uid(),
      name: file.name.replace(/\.[^.]+$/, ""),
      objects: [d],
    };
    currentActor.models.push(model);
    currentActor.active = currentActor.models.length - 1;
    save({ sceneChanged: true, actorName: currentActor.name });
    if (this.root.isConnected && actor() === currentActor) {
      state.selected = [d.id];
      this.refresh();
    }
    updateThumbnails();
  }
  async importMap(kind, file) {
    const one = this.propertyTarget();
    if (!one) return;
    const currentActor = actor();
    const generation = assetGeneration;
    const isModelObject = this.nodes.has(one.id);
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    await new Promise((resolve, reject) => { const image = new Image(); image.onload = resolve; image.onerror = () => reject(new Error("Invalid texture image")); image.src = data; });
    if (generation !== assetGeneration) return;
    one.maps[kind] = data;
    if (isModelObject) save({ sceneChanged: true, actorName: currentActor?.name });
    if (this.root.isConnected && actor() === currentActor) {
      if (this.nodes.has(one.id)) this.refresh();
      else this.updateUI();
    }
  }
  dispose() {
    clearTimeout(this.historyTimer);
    this.resizeObserver.disconnect();
    window.removeEventListener("keydown", this.onKey);
    document.removeEventListener("pointerdown", this.onOutsidePointer);
    this.controls.dispose();
    for (const control of this.gizmos) control.dispose();
    for (const helper of this.selectionHelpers.values()) { helper.geometry.dispose(); helper.material.dispose(); }
    clearTimeout(this.statusTimer);
    this.wireframeOverlay.clear();
    for (const child of this.content.children) disposeGroup(child);
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.root.remove();
    if (getEditor() === this) setEditor(null);
  }
}
