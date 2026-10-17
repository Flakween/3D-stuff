/**
 * Host registry.
 *
 * The renderer, the model editor, the scene editor and the persistence layer
 * all need to reach each other, but only at call time. Keeping the shared
 * instances here means the module graph stays a tree instead of a knot of
 * circular imports.
 */

export interface StageHost {
  readonly host: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  invalidate(forceRender?: boolean): void;
  markDirty(actorName?: string | null): void;
  sync(): void;
  bindVM(vm: unknown): boolean;
  captureFrame(): string | null;
  dispose(): void;
}

export interface EditorHost {
  readonly root: HTMLElement;
  readonly panel: HTMLElement;
  readonly nodes: Map<string, unknown>;
  readonly lastTarget: string | null;
  history: unknown[];
  historyIndex: number;
  historyPending: boolean;
  recordHistory(immediate?: boolean): void;
  refresh(): void;
  updateUI(): void;
  updateGizmo(): void;
  applyView(): void;
  render(): void;
  resize(): void;
  focusModel(): void;
  dispose(): void;
  selectedData(): Array<{ id: string }>;
}

export interface SceneEditorHost {
  readonly root: HTMLElement;
  readonly panel: HTMLElement;
  sync(): void;
  dispose(): void;
}

let stage: StageHost | null = null;
let editor: EditorHost | null = null;
let sceneEditor: SceneEditorHost | null = null;
let poseSync: (() => void) | null = null;
let renderRequest: (() => void) | null = null;

export const getStage = (): StageHost | null => stage;
export const setStage = (value: StageHost | null): void => {
  stage = value;
};

export const getEditor = (): EditorHost | null => editor;
export const setEditor = (value: EditorHost | null): void => {
  editor = value;
};

export const getSceneEditor = (): SceneEditorHost | null => sceneEditor;
export const setSceneEditor = (value: SceneEditorHost | null): void => {
  sceneEditor = value;
};

/** Called after a runtime transform changed so the pose fields can refresh. */
export const schedulePoseControlsSync = (): void => {
  poseSync?.();
};

export const setPoseControlsSync = (handler: (() => void) | null): void => {
  poseSync = handler;
};

/** Ask for a repaint of the stage and, when it is open, of the model editor. */
export const requestRender = (): void => {
  renderRequest?.();
};

export const setRenderRequest = (handler: (() => void) | null): void => {
  renderRequest = handler;
};
