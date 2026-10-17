import { getStage } from "../app.ts";
import { dataForTarget } from "../runtime/actors.ts";
import { runtime } from "../state.ts";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
import { syncTargetPoseControls } from "./pose-controls.js";

export function escapeHTML(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
export const capitalize = (s) => s[0].toUpperCase() + s.slice(1);
export function thumbnail(model) {
  const stage = getStage();
  if (stage && !stage.disposed && !stage.contextLost) {
    try {
      return stage.renderThumbnail(model);
    } catch (error) {
      console.warn("Unable to render a 3D model thumbnail", error);
    }
  }
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="72" viewBox="0 0 96 72"><rect width="96" height="72" rx="8" fill="#f3f4f8"/><path d="m48 14 23 13v19L48 59 25 46V27zM25 27l23 14 23-14M48 41v18" fill="#855cd6" fill-opacity=".22" stroke="#855cd6" stroke-width="2" stroke-linejoin="round"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(icon)}`;
}
export const thumbnailCache = new Map();
export let thumbnailEpoch = 0;
let thumbnailsScheduled = false;
export function clearThumbnails() {
  thumbnailCache.clear();
  thumbnailEpoch++;
}
export function modelThumbnail(model, actorName) {
  const version = runtime.actorRevisions.get(actorName) || 0;
  const cached = thumbnailCache.get(model.id);
  if (cached?.model === model && cached.version === version) {
    // Keep frequently visible models in a bounded LRU cache.
    thumbnailCache.delete(model.id);
    thumbnailCache.set(model.id, cached);
    return cached.src;
  }
  const src = thumbnail(model);
  thumbnailCache.set(model.id, { model, version, src });
  if (thumbnailCache.size > 128) thumbnailCache.delete(thumbnailCache.keys().next().value);
  return src;
}
export function updateThumbnails() {
  if (thumbnailsScheduled) return;
  thumbnailsScheduled = true;
  requestAnimationFrame(() => {
    thumbnailsScheduled = false;
    syncThumbnails();
  });
}
export function syncThumbnails() {
  const vm = window.vm;
  if (!vm || runtime.projectLoading) return;
  const targetsByName = new Map(vm.runtime.targets
    .filter(target => target.isOriginal && !target.isStage)
    .map(target => [target.sprite.name, target]));
  const tiles = $$('[class*="sprite-selector-item_sprite-selector-item_"]');
  for (const tile of tiles) {
    const name = $('[class*="sprite-selector-item_sprite-name_"]', tile)?.textContent;
    const target = targetsByName.get(name);
    const data = target && dataForTarget(target);
    const model = data?.models?.[data.active];
    if (!model) {
      $(".d3-thumbnail", tile)?.remove();
      continue;
    }
    const src = modelThumbnail(model, data.name);
    let img = $(".d3-thumbnail", tile);
    if (!img) {
      img = document.createElement("img");
      img.className = "d3-thumbnail";
      img.alt = "3D model thumbnail";
      $('[class*="sprite-selector-item_sprite-image-outer_"]', tile)?.append(img);
    }
    if (img.src !== src) img.src = src;
  }
}
export function updateActorLabels() {
  const pane = $(
    '[class*="target-pane_target-pane_"],[class*="sprite-selector-item_sprite-selector-item_"]',
  );
  if (!pane) return;
  const relabel = (value) => value
    .replace(/\bSprites\b/g, "Actors")
    .replace(/\bSprite\b/g, "Actor")
    .replace(/\bBackdrops\b/g, "Scenes")
    .replace(/\bBackdrop\b/g, "Scene")
    .replace(/\bbackdrops\b/g, "scenes")
    .replace(/\bbackdrop\b/g, "scene");
  const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest("input,textarea,[contenteditable]"))
      continue;
    const text = node.nodeValue;
    if (/\b(?:Sprites?|Backdrops?|backdrops?)\b/.test(text))
      node.nodeValue = relabel(text);
  }
  for (const el of $$("[title],[aria-label]", pane)) {
    for (const attr of ["title", "aria-label"]) {
      const v = el.getAttribute(attr);
      if (v && /\b(?:Sprites?|Backdrops?|backdrops?)\b/.test(v))
        el.setAttribute(attr, relabel(v));
    }
  }
  syncTargetPoseControls();
}

