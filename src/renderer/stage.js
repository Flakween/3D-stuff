import * as THREE from "three";
import { makeRenderer, makeScene } from "./scene.js";
import { envTexture } from "./textures.js";
import { textureLoader } from "./asset-cache.js";
import { buildObject } from "./build.js";
import { disposeGroup } from "./dispose.js";
import { applyMaps, setMaterialProperties } from "./materials.js";
import { scratchTargetPose } from "../core/coordinates.ts";
import { dataForTarget, runtimeTransform } from "../runtime/actors.ts";
import { Runtime3DBridge } from "../runtime/bridge.ts";
import { runtime, state } from "../state.ts";
import { getSceneEditor } from "../app.ts";
import { reconcileScenes, sceneSettings } from "../model-editor/scenes.js";

export class Stage3D {
  constructor(host) {
    this.host = host;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "d3-stage-canvas";
    this.canvas.setAttribute("aria-label", "3D stage");
    host.append(this.canvas);
    this.badge = document.createElement("div");
    this.badge.className = "d3-stage-badge";
    this.badge.setAttribute("aria-live", "polite");
    host.append(this.badge);
    this.renderer = makeRenderer(this.canvas);
    this.scene = makeScene(false);
    this.sceneKey = "";
    this.skyTexture = null;
    this.skyTextureURL = null;
    this.thumbnailCanvas = document.createElement("canvas");
    this.thumbnailCanvas.width = 96;
    this.thumbnailCanvas.height = 72;
    this.thumbnailRenderer = null;
    this.thumbnailScene = new THREE.Scene();
    this.thumbnailScene.environment = envTexture;
    this.thumbnailScene.add(new THREE.HemisphereLight(0xffffff, 0x858080, 2.8));
    const thumbnailLight = new THREE.DirectionalLight(0xffffff, 3);
    thumbnailLight.position.set(3, 5, 4);
    this.thumbnailScene.add(thumbnailLight);
    this.thumbnailCamera = new THREE.PerspectiveCamera(38, 4 / 3, 0.1, 100);
    this.thumbnailCamera.position.set(3, 2.5, 4);
    this.thumbnailCamera.lookAt(0, 0.6, 0);
    this.camera = new THREE.PerspectiveCamera(42, 4 / 3, 0.1, 200);
    this.camera.position.set(5, 3.4, 7.2);
    this.camera.lookAt(0, 1, 0);
    this.objects = new THREE.Group();
    this.objects.name = "runtime actors";
    this.scene.add(this.objects);
    this.entries = new Map();
    this.allDirty = true;
    this.dirtyActorNames = new Set();
    this.raf = 0;
    this.running = false;
    this.disposed = false;
    this.pixelRatio = 0;
    this.width = 0;
    this.height = 0;
    this.frame = this.frame.bind(this);
    this.onVisibilityChange = () => {
      if (document.hidden) this.cancelFrame();
      else this.invalidate();
    };
    this.vm = null;
    this.runtime = null;
    this.runtimeBridge = new Runtime3DBridge({
      onStart: () => this.start(),
      onStop: () => this.stop(),
      onTick: () => this.invalidate(false),
      onChange: () => this.invalidate(false),
    });
    this.bindVM(window.vm);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    window.addEventListener("resize", (this.onResize = () => this.resize()));
    this.onContextLost = (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.badge.textContent = "3D renderer unavailable";
    };
    this.onContextRestored = () => {
      this.contextLost = false;
      this.sceneKey = "";
      this.invalidate();
    };
    this.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.canvas.addEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    this.resize();
    this.invalidate();
  }

  bindVM(vm) {
    const runtime = vm?.runtime || null;
    if (this.vm === vm && this.runtime === runtime) return false;

    this.runtimeBridge.bind(vm);
    this.vm = this.runtimeBridge.vm;
    this.runtime = this.runtimeBridge.runtime;
    state.targetTransforms.clear();

    this.allDirty = true;
    this.dirtyActorNames.clear();
    if ((this.runtime?._nonMonitorThreadCount || 0) > 0) this.start();
    else this.invalidate();
    return true;
  }

  markDirty(actorName = null) {
    if (actorName) this.dirtyActorNames.add(actorName);
    else this.allDirty = true;
    this.invalidate();
  }

  sync() {
    this.invalidate(false);
  }

  resize() {
    if (this.disposed) return;
    const rect = this.host.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width < 1 || height < 1) return;
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

  start() {
    this.running = true;
    this.invalidate();
  }

  stop() {
    this.running = false;
    this.invalidate();
  }

  cancelFrame() {
    if (!this.raf) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  invalidate(forceRender = true) {
    if (this.disposed) return;
    if (forceRender) this.needsRender = true;
    if (document.hidden || this.contextLost || runtime.projectLoading || this.raf) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  frame() {
    this.raf = 0;
    if (this.disposed || document.hidden || this.contextLost || runtime.projectLoading) return;
    const environmentChanged = this.applySceneSettings();
    const changed = this.syncScene();
    if (changed || environmentChanged || this.needsRender) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
  }

  captureFrame() {
    if (this.disposed || this.contextLost || runtime.projectLoading) return null;
    this.applySceneSettings();
    this.syncScene();
    this.renderer.render(this.scene, this.camera);
    this.needsRender = false;
    return this.canvas.toDataURL("image/png");
  }

  applySceneSettings() {
    const stageTarget = this.vm?.runtime?.getTargetForStage?.();
    if (!stageTarget) return false;
    const index = stageTarget.currentCostume || 0;
    const costumes = stageTarget.getCostumes();
    const key = `${index}:${costumes.length}:${costumes[index]?.name}:${runtime.sceneRevision}`;
    if (this.sceneKey === key && this.sceneTarget === stageTarget) return false;
    this.sceneKey = key;
    this.sceneTarget = stageTarget;
    reconcileScenes();
    const settings = sceneSettings(index);
    this.badge.textContent = `SCENE ${index + 1}  /  ${costumes[index]?.name || "Scene"}`;
    const sky = this.scene.getObjectByName("3D background");
    if (this.skyTexture && (settings.skyMode !== "texture" || settings.skyTexture !== this.skyTextureURL)) {
      this.skyTexture.dispose(); this.skyTexture = null; this.skyTextureURL = null;
    }
    sky.visible = settings.skyMode === "gradient" || (settings.skyMode === "texture" && !settings.skyTexture);
    sky.material.uniforms.uSkyColor.value.set(settings.skyColor).convertLinearToSRGB();
    this.scene.background = null;
    this.scene.environment = envTexture;
    if (settings.skyMode === "color") this.scene.background = new THREE.Color(settings.skyColor);
    if (settings.skyMode === "texture" && settings.skyTexture) {
      if (!this.skyTexture) {
        this.skyTextureURL = settings.skyTexture;
        this.skyTexture = textureLoader.load(settings.skyTexture, () => {
          if (this.skyTextureURL === settings.skyTexture) this.invalidate();
        });
        this.skyTexture.mapping = THREE.EquirectangularReflectionMapping;
        this.skyTexture.colorSpace = THREE.SRGBColorSpace;
      }
      this.scene.background = this.skyTexture;
      this.scene.environment = this.skyTexture;
    }
    this.scene.fog = settings.fogEnabled
      ? new THREE.FogExp2(settings.fogColor, Number(settings.fogDensity)) : null;
    this.renderer.toneMappingExposure = Number(settings.exposure);
    this.renderer.shadowMap.enabled = !!settings.shadows;
    this.canvas.style.filter = `brightness(${settings.brightness}) contrast(${settings.contrast}) saturate(${settings.saturation})`;
    const floor = this.scene.getObjectByName("3D ground");
    floor.material.color.set(settings.groundColor);
    floor.receiveShadow = !!settings.shadows;
    const ambient = this.scene.children.find((item) => item.isHemisphereLight);
    const sun = this.scene.children.find((item) => item.isDirectionalLight);
    if (ambient) ambient.intensity = Number(settings.ambient);
    if (sun) { sun.intensity = Number(settings.sun); sun.castShadow = !!settings.shadows; }
    if (getSceneEditor()?.panel.classList.contains("d3-scene-active")) getSceneEditor()?.sync();
    return true;
  }

  rebuildEntries() {
    for (const entry of this.entries.values()) {
      this.objects.remove(entry.group);
      disposeGroup(entry.group);
    }
    this.entries.clear();
  }

  createEntry(model) {
    const group = new THREE.Group();
    group.name = "3D actor model";
    const nodes = new Map();
    for (const object of model.objects) {
      nodes.set(object.id, buildObject(object));
    }
    for (const object of model.objects) {
      const node = nodes.get(object.id);
      (nodes.get(object.parent) || group).add(node);
    }
    this.objects.add(group);
    return { group, nodes, modelId: model.id, lastRevision: -1 };
  }

  updateEntry(target, data, model, entry) {
    const transform = runtimeTransform(target, data);
    const pose = scratchTargetPose(target, transform);
    const {
      x,
      y,
      direction,
      size,
      visible,
      height,
      yaw,
      pitch,
      roll,
    } = pose;
    const transformChanged = entry.x !== x || entry.y !== y ||
      entry.direction !== direction || entry.size !== size || entry.visible !== visible ||
      entry.height !== height || entry.yaw !== yaw ||
      entry.pitch !== pitch || entry.roll !== roll;
    const dataRevision = runtime.actorRevisions.get(data?.name) || 0;
    const dataChanged = entry.lastRevision !== dataRevision;
    if (!transformChanged && !dataChanged) return false;

    if (transformChanged) {
      entry.group.position.fromArray(pose.position);
      entry.group.rotation.order = "YZX";
      entry.group.rotation.fromArray(pose.rotation);
      entry.group.scale.setScalar(pose.scale);
      entry.group.visible = visible;
      entry.x = x;
      entry.y = y;
      entry.direction = direction;
      entry.size = size;
      entry.visible = visible;
      entry.height = height;
      entry.yaw = yaw;
      entry.pitch = pitch;
      entry.roll = roll;
    }

    if (dataChanged)
      for (const object of model.objects) {
        const node = entry.nodes.get(object.id);
        if (!node) continue;
        node.name = object.name;
        node.position.fromArray(object.position);
        node.rotation.fromArray(object.rotation);
        node.scale.fromArray(object.scale);
        const modelContent = node.children.find(child => child.isMesh || child.userData.d3ModelContent);
        if (modelContent) {
          modelContent.position.fromArray(object.meshPosition);
          modelContent.rotation.fromArray(object.meshRotation);
          modelContent.scale.fromArray(object.meshScale);
        }
        node.traverse((child) => {
          if (!child.isMesh || !child.material) return;
          let owner = child; while (owner && !owner.userData.objectId) owner = owner.parent;
          if (owner?.userData.objectId !== object.id) return;
          if (object.type === "import" && !object.materialOverride) {
            applyMaps(child, object);
            return;
          }
          setMaterialProperties(child, object);
          applyMaps(child, object);
        });
      }
    entry.lastRevision = dataRevision;
    return true;
  }

  syncScene() {
    const vm = this.vm;
    if (!vm?.runtime?.targets) return false;
    let changed = false;
    if (this.allDirty) {
      this.rebuildEntries();
      this.allDirty = false;
      this.dirtyActorNames.clear();
      changed = true;
    }
    const seen = new Set();
    const frameId = this.syncVersion = (this.syncVersion || 0) + 1;
    for (const target of vm.runtime.targets) {
      if (target.isStage) continue;
      seen.add(target.id);
      const data = dataForTarget(target);
      const model = data?.models?.[target.isOriginal ? data.active : (runtime.cloneModels.get(target.id) ?? data.active)];
      if (!model) continue;
      let entry = this.entries.get(target.id);
      const actorDirty = this.dirtyActorNames.has(data?.name);
      if (!entry || entry.modelId !== model.id || actorDirty) {
        if (entry) {
          this.objects.remove(entry.group);
          disposeGroup(entry.group);
        }
        entry = this.createEntry(model);
        this.entries.set(target.id, entry);
        changed = true;
      }
      entry.lastSeenFrame = frameId;
      if (this.updateEntry(target, data, model, entry)) changed = true;
    }
    for (const targetId of state.targetTransforms.keys()) {
      if (!seen.has(targetId)) state.targetTransforms.delete(targetId);
    }
    for (const targetId of runtime.cloneModels.keys()) {
      if (!seen.has(targetId)) runtime.cloneModels.delete(targetId);
    }
    for (const [targetId, entry] of this.entries) {
      if (entry.lastSeenFrame === frameId) continue;
      this.objects.remove(entry.group);
      disposeGroup(entry.group);
      this.entries.delete(targetId);
      state.targetTransforms.delete(targetId);
      changed = true;
    }
    this.dirtyActorNames.clear();
    return changed;
  }

  renderThumbnail(model) {
    if (!this.thumbnailRenderer) {
      this.thumbnailRenderer = makeRenderer(this.thumbnailCanvas, false, true);
      this.thumbnailRenderer.setSize(96, 72, false);
      this.thumbnailRenderer.setClearColor(0xffffff, 0);
      this.thumbnailRenderer.shadowMap.enabled = false;
    }
    const old = this.thumbnailScene.getObjectByName("thumbnail-model");
    if (old) {
      this.thumbnailScene.remove(old);
      disposeGroup(old);
    }
    const group = new THREE.Group();
    group.name = "thumbnail-model";
    const nodes = new Map();
    for (const object of model.objects) {
      nodes.set(object.id, buildObject(object, false));
    }
    for (const object of model.objects) {
      (nodes.get(object.parent) || group).add(nodes.get(object.id));
    }
    this.thumbnailScene.add(group);
    const bounds = new THREE.Box3().setFromObject(group);
    if (!bounds.isEmpty()) {
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const distance = Math.max(2, size.length() * 1.5);
      this.thumbnailCamera.position
        .copy(center)
        .add(
          new THREE.Vector3(0.65, 0.5, 0.85)
            .normalize()
            .multiplyScalar(distance),
        );
      this.thumbnailCamera.near = Math.max(0.01, distance / 100);
      this.thumbnailCamera.far = Math.max(100, distance * 10);
      this.thumbnailCamera.lookAt(center);
      this.thumbnailCamera.updateProjectionMatrix();
    }
    try {
      this.thumbnailRenderer.render(this.thumbnailScene, this.thumbnailCamera);
      return this.thumbnailCanvas.toDataURL("image/png");
    } finally {
      this.thumbnailScene.remove(group);
      disposeGroup(group);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelFrame();
    this.resizeObserver.disconnect();
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.runtimeBridge.detach();
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    this.rebuildEntries();
    this.skyTexture?.dispose();
    this.thumbnailRenderer?.dispose();
    this.thumbnailRenderer?.forceContextLoss?.();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.canvas.remove();
    this.badge.remove();
  }
}
