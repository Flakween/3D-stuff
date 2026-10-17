export const uiIcon = (name, size = 24) => {
  const paths = {
    copy: '<path d="M5 2h9l5 5v15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill="currentColor"/><path d="M14 2v5h5" fill="#ffb3b3"/><path d="M11 11v7m-3.5-3.5h7" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
    paste: '<path d="M5 2h9l5 5v15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill="currentColor"/><path d="M14 2v5h5" fill="#ffb3b3"/><path d="M11 10v8m0 0-3-3m3 3 3-3" stroke="#141414" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    delete: '<path d="M4 5h16v3H4zm5-2h6v2H9zM5.5 9h13l-1.2 13.5a2 2 0 0 1-2 1.5H8.7a2 2 0 0 1-2-1.5Z" fill="currentColor"/><path d="m9.5 12 .5 8.5M12 12v8.5m2.5-8.5-.5 8.5" stroke="#141414" stroke-width="1.5" stroke-linecap="round"/>',
    undo: '<path d="M7 3 2.5 7.2 7 11.4V8.5c4.2 0 6.8 1.3 8.2 4-1-4.5-3.6-6.9-8.2-6.9V3Z" fill="currentColor"/>',
    redo: '<path d="m11 3 4.5 4.2-4.5 4.2V8.5c-4.2 0-6.8 1.3-8.2 4 1-4.5 3.6-6.9 8.2-6.9V3Z" fill="currentColor"/>',
    select: '<path d="M5 2v18l4.3-4 3 6 2.8-1.4-3.1-6.2h6Z" fill="currentColor"/>',
    gizmo: '<path d="M16 16V4m0 0-3 3m3-3 3 3M16 16 5 22m0 0 1-4m-1 4 4 .5M16 16l11 6m0 0-4 .5m4-.5-1-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="m16 12 4 2.5v5L16 22l-4-2.5v-5Z" fill="#141414" stroke="currentColor" stroke-width="1.3"/><path d="m12 14.5 4 2.5 4-2.5M16 17v5" stroke="currentColor" stroke-width="1.2"/>',
    shapes: '<path d="m9 6 6 19H3Zm11-1a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm-3 12h10v9H17Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/>',
    wire: '<path d="m5 5 11-2 4 4v11L9 20l-4-4Zm0 0 4 4 11-2M9 9v11M9 9l11 9" stroke="currentColor" stroke-width="1.3" fill="none"/>',
    tree: '<path d="M6 3v16m0-8h6m-6 6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="6" cy="5" r="2" fill="currentColor"/><circle cx="15" cy="11" r="2" fill="currentColor"/><circle cx="15" cy="17" r="2" fill="currentColor"/>',
    grid: '<path d="M8 3v16m6-16v16M3 8h16M3 14h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    moon: '<path d="M10.5 3c3.3 1.2 5 5 3.7 8.8-1 2.9-3.7 4.7-6.7 4.9 2.7-1.9 3.8-5.5 2.7-9-.5-1.8-1.6-3.3-3-4.3 1.1-.4 2.2-.5 3.3-.4Z" fill="currentColor"/>',
    zoomOut: '<circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M5.5 8h5m2 4 3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    zoomIn: '<circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M5.5 8h5M8 5.5v5m4.5 1.5 3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    zoomReset: '<path d="M5 7h8M5 11h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  };
  const viewBox = ["gizmo", "shapes"].includes(name) ? "0 0 32 32" : ["copy", "paste", "delete"].includes(name) ? "0 0 24 26" : name.startsWith("zoom") ? "0 0 18 18" : "0 0 24 24";
  return `<svg width="${size}" height="${size}" viewBox="${viewBox}" fill="none" aria-hidden="true">${paths[name]}</svg>`;
};

export function editorMarkup(icon = uiIcon) {
  const field = (label, content, extra = '') => `<label class="d3-field-block" ${extra}><span>${label}</span>${content}</label>`;
  const pop = (name, label, body) => `<div class="d3-popup d3-${name}" role="dialog" aria-label="${label}" hidden><div class="d3-popup-heading"><strong>${label}</strong><button data-action="close-pop" aria-label="Close">×</button></div>${body}</div>`;
  const button = (name, label, extra = '') => `<button class="d3-option-button" data-pop="${name}" aria-expanded="false" ${extra}>${label}<span class="d3-caret"></span></button>`;
  const maps = [['texture','Base color'],['roughness','Roughness'],['metallic','Metallic'],['normal','Normal'],['opacity','Opacity']];
  return `
    <aside class="d3-assets" aria-label="3D models">
      <div class="d3-model-list" role="list" aria-label="Models"></div>
      <div class="d3-add-wrap">
        <button class="d3-add-fab" data-action="add-menu" title="Add a model" aria-label="Add a model">+</button>
        <div class="d3-add-menu" hidden><button data-action="empty">New empty model</button><button data-action="import">Import GLB, glTF, OBJ</button></div>
        <input class="d3-import" type="file" accept=".glb,.gltf,.obj" hidden>
      </div>
    </aside>
    <main class="d3-workspace">
      <header class="d3-topbar">
        <div class="d3-toolbar-row d3-toolbar-first">
          <div class="d3-name-group">
            ${field('Model','<input class="d3-model-name" aria-label="Model name">')}
            ${field('Object','<input class="d3-object-name" aria-label="Object name" placeholder="Select an object">')}
          </div>
          <div class="d3-common-actions">
            <button data-action="copy" data-requires-selection title="Copy">${icon('copy',19)}</button>
            <button data-action="paste" title="Paste" disabled>${icon('paste',19)}</button>
            <button data-action="delete" data-requires-selection title="Delete">${icon('delete',19)}</button>
            <button data-action="undo" title="Undo (Ctrl+Z)">${icon('undo',19)}</button>
            <button data-action="redo" title="Redo (Ctrl+Y)">${icon('redo',19)}</button>
          </div>
        </div>
        <div class="d3-toolbar-row d3-toolbar-second">
          <div class="d3-selection-extra" hidden>
            <button class="d3-box-toggle" data-action="box" aria-pressed="false">Box select</button>
            <select class="d3-filter" aria-label="Selection filter">${[['all','All objects'],['cube','Cubes'],['sphere','Spheres'],['cone','Cones'],['cylinder','Cylinders'],['plane','Planes'],['torus','Tori'],['star','Stars'],['import','Imports']].map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select>
            <div class="d3-parent-actions" role="group" aria-label="Parenting">
              <button data-action="parent" title="Parent to the last selected object">Parent</button>
              <button class="d3-chain" data-action="chain" title="Last selected is the root; earlier objects form a chain">Parent chain</button>
            </div>
          </div>
          <div class="d3-transform-tools" hidden>
            <select class="d3-transform" aria-label="Gizmo handles"><option value="all">All</option><option value="move">Move</option><option value="rotate">Rotate</option><option value="scale">Scale</option></select>
            <select class="d3-space" aria-label="Transform space" title="Edit Local moves the saved pivot without moving the object"><option value="world">World</option><option value="local">Local</option><option value="pivot">Edit Local</option></select>
            ${button('inspector-panel','Transform')}
          </div>
          <div class="d3-shape-options" hidden>
            ${button('mesh-menu','Cube')}
            <label class="d3-inline-check"><input class="d3-snap" type="checkbox" checked>Snap</label>
          </div>
          ${field('Color',`<button class="d3-swatch-picker" data-pop="color-panel" aria-label="Color" aria-expanded="false"><span class="d3-color-swatch"></span><span class="d3-swatch-arrow"><span class="d3-caret"></span></span></button>`, 'data-requires-one')}
          ${field('Material',`<button class="d3-option-button" data-pop="maps" aria-expanded="false"><span class="d3-material-swatch"></span>Textures<span class="d3-caret"></span></button>`, 'data-requires-one')}
          <div class="d3-geometry-options">
            ${field('Subdivisions',`<span class="d3-stepper"><input class="d3-subdiv" type="number" min="1" max="16" value="1" aria-label="Subdivisions" title="Refinement: 1, 2, 4, 8, or 16"><span class="d3-step-buttons"><button data-action="subdiv-up" aria-label="Increase subdivisions">▴</button><button data-action="subdiv-down" aria-label="Decrease subdivisions">▾</button></span></span>`, 'data-requires-one')}
            <label class="d3-inline-check" data-requires-one title="Subdivide without smoothing; preserve sharp edges"><input class="d3-linear" type="checkbox">Linear</label>
            <label class="d3-star-only">Points <input class="d3-points" type="number" min="3" max="24" value="5"></label>
            <label class="d3-star-only">Inner angle <input class="d3-inner" type="number" min="30" max="175" value="120">°</label>
          </div>
        </div>
        ${pop('color-panel','Color',`<input type="color" class="d3-color" value="#ffffff" aria-label="Choose color"><label>Hex <input type="text" class="d3-color-hex" aria-label="Hex color" maxlength="7" value="#ffffff"></label><div class="d3-color-sliders">${['metallic','smoothness','opacity'].map(k=>`<label>${k[0].toUpperCase()+k.slice(1)} <output data-output="${k}"></output><input type="range" class="d3-${k}" min="0" max="1" step=".01" aria-label="${k}"></label>`).join('')}</div>`)}
        ${pop('maps','Material textures',maps.map(([k,l])=>`<div class="d3-map-row"><img data-preview="${k}" alt="" hidden><span class="d3-map-placeholder" data-placeholder="${k}">+</span><label>${l}<span class="d3-map-file" data-map-name="${k}">No texture</span><input type="file" data-map="${k}" accept="image/*" aria-label="Upload ${l} texture"></label><button data-remove-map="${k}" aria-label="Remove ${l} texture">×</button></div>`).join(''))}
        ${pop('mesh-menu','Shapes','<div class="d3-shape-grid"></div>')}
        ${pop('inspector-panel','Transform',`<div class="d3-inspector"><span class="d3-selection-count"></span><div class="d3-transform-inspector">${['position','rotation','scale'].map(p=>`<fieldset><legend>${p[0].toUpperCase()+p.slice(1)}${p==='rotation'?' (°)':''}</legend>${['X','Y','Z'].map((a,i)=>`<label>${a}<input class="d3-transform-field" data-transform="${p}" data-axis="${i}" type="number" step="${p==='rotation'?1:.1}" aria-label="${p} ${a}"></label>`).join('')}</fieldset>`).join('')}</div></div>`)}
      </header>
      <div class="d3-center">
        <nav class="d3-tools" role="toolbar" aria-label="Model tools"></nav>
        <div class="d3-view" aria-label="3D model canvas"><canvas class="d3-canvas" aria-label="3D model editor canvas"></canvas><div class="d3-box" hidden></div><div class="d3-hierarchy" aria-label="Object hierarchy"><span class="d3-tree-root">Model</span><div class="d3-hierarchy-items"></div></div><div class="d3-status" role="status" hidden></div></div>
      </div>
      <footer class="d3-bottom">
        <div class="d3-view-options"><select class="d3-view-mode" aria-label="Viewport shading"><option value="madcap">Matcap</option><option value="unlit">Unlit</option><option value="rendered">Rendered</option></select>${button('view-settings','Settings')}</div>
        <div class="d3-bottom-controls"><div class="d3-segmented"><button data-action="wireframe" title="Wireframe" aria-label="Wireframe">${icon('wire')}</button><button class="d3-hierarchy-toggle" title="Hierarchy" aria-label="Hierarchy">${icon('tree')}</button><button data-action="grid" title="Grid" aria-label="Grid">${icon('grid')}</button></div><div class="d3-segmented"><button data-action="zoom-out" title="Zoom out">${icon('zoomOut',18)}</button><button data-action="zoom-reset" title="Frame model">${icon('zoomReset',18)}</button><button data-action="zoom-in" title="Zoom in">${icon('zoomIn',18)}</button></div><button data-action="export" class="d3-export">Export</button></div>
        ${pop('view-settings','View settings',`<label>Background <input class="d3-background" type="color" value="#000000" aria-label="Viewport background"></label><label class="d3-exposure-row">Exposure <input class="d3-exposure" type="range" min=".5" max="2.5" step=".05" value="1.25"></label><button data-action="shadows" aria-pressed="true">Shadows</button>`)}
      </footer>
    </main>`;
}
