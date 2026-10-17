/**
 * Project runtime settings.
 *
 * Settings are data, not navigation. Changing them must never refresh
 * Blockly, restart scripts, or rebuild the VM. Legacy config comments still
 * load through TurboWarp; this snapshot takes precedence when present in an
 * archive.
 */

export interface VmLike {
  runtime?: RuntimeLike;
  setCompilerOptions?: (options: Record<string, unknown>) => void;
  setStageSize?: (width: number, height: number) => void;
  setFramerate?: (value: number) => void;
  setTurboMode?: (value: boolean) => void;
  setInterpolation?: (value: boolean) => void;
  setRuntimeOptions?: (options: Record<string, unknown>) => void;
}

interface RuntimeLike {
  stageWidth?: number;
  stageHeight?: number;
  frameLoop?: { framerate?: number };
  turboMode?: boolean;
  interpolationEnabled?: boolean;
  renderer?: { useHighQualityRender?: boolean; setUseHighQualityRender?: (value: boolean) => void };
  runtimeOptions?: { maxClones?: number; fencing?: boolean; miscLimits?: boolean };
  compilerOptions?: { warpTimer?: boolean; enabled?: boolean };
  getTargetForStage?: () => unknown;
  emitProjectChanged?: () => void;
}

export interface RuntimeSettingsSnapshot {
  version: number;
  width?: number;
  height?: number;
  framerate?: number;
  turbo?: boolean;
  interpolation?: boolean;
  highQualityPen?: boolean;
  maxClones?: number | "Infinity";
  fencing?: boolean;
  miscLimits?: boolean;
  warpTimer?: boolean;
  compilerEnabled?: boolean;
}

const installed = new WeakSet<object>();

const sameOptions = (
  current: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): boolean => Object.keys(next).every((key) => Object.is(current?.[key], next[key]));

export function stageDimensions(
  width: unknown,
  height: unknown,
): [number, number] | null {
  if (width === "" || height === "") return null;
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return [
    Math.min(4096, Math.max(1, Math.round(w))),
    Math.min(4096, Math.max(1, Math.round(h))),
  ];
}

export function captureRuntimeSettings(vm: VmLike | null | undefined): RuntimeSettingsSnapshot | undefined {
  const runtime = vm?.runtime;
  if (!runtime) return undefined;
  return {
    version: 2,
    width: runtime.stageWidth,
    height: runtime.stageHeight,
    framerate: runtime.frameLoop?.framerate,
    turbo: !!runtime.turboMode,
    interpolation: !!runtime.interpolationEnabled,
    highQualityPen: !!runtime.renderer?.useHighQualityRender,
    maxClones:
      runtime.runtimeOptions?.maxClones === Infinity
        ? "Infinity"
        : runtime.runtimeOptions?.maxClones,
    fencing: !!runtime.runtimeOptions?.fencing,
    miscLimits: !!runtime.runtimeOptions?.miscLimits,
    warpTimer: !!runtime.compilerOptions?.warpTimer,
    compilerEnabled: !!runtime.compilerOptions?.enabled,
  };
}

export function restoreRuntimeSettings(
  vm: VmLike | null | undefined,
  settings: RuntimeSettingsSnapshot | null | undefined,
): void {
  if (!vm || !settings || typeof settings !== "object") return;
  const compiler: Record<string, unknown> = {};
  if (typeof settings.warpTimer === "boolean") compiler.warpTimer = settings.warpTimer;
  if (typeof settings.compilerEnabled === "boolean") compiler.enabled = settings.compilerEnabled;
  if (Object.keys(compiler).length && typeof vm.setCompilerOptions === "function") {
    vm.setCompilerOptions(compiler);
  }
  // Older project archives stored only compiler settings.
  if (settings.version !== 2) return;
  const dimensions = stageDimensions(settings.width, settings.height);
  if (dimensions && typeof vm.setStageSize === "function") vm.setStageSize(...dimensions);
  if (
    Number.isFinite(settings.framerate) &&
    (settings.framerate as number) >= 0 &&
    typeof vm.setFramerate === "function"
  ) {
    vm.setFramerate(settings.framerate as number);
  }
  if (typeof settings.turbo === "boolean" && typeof vm.setTurboMode === "function") {
    vm.setTurboMode(settings.turbo);
  }
  if (typeof settings.interpolation === "boolean" && typeof vm.setInterpolation === "function") {
    vm.setInterpolation(settings.interpolation);
  }
  const options: Record<string, unknown> = {};
  if (settings.maxClones === "Infinity") options.maxClones = Infinity;
  else if (Number.isFinite(settings.maxClones) && (settings.maxClones as number) >= 0) {
    options.maxClones = settings.maxClones;
  }
  for (const key of ["fencing", "miscLimits"] as const) {
    if (typeof settings[key] === "boolean") options[key] = settings[key];
  }
  if (Object.keys(options).length && typeof vm.setRuntimeOptions === "function") {
    vm.setRuntimeOptions(options);
  }
  const renderer = vm.runtime?.renderer;
  if (
    typeof settings.highQualityPen === "boolean" &&
    renderer?.useHighQualityRender !== settings.highQualityPen
  ) {
    renderer?.setUseHighQualityRender?.(settings.highQualityPen);
  }
}

/**
 * Wrap the VM setters so a change is reported as a project change without
 * touching workspace XML or restarting scripts.
 */
export function installRuntimeSettings(
  vm: VmLike | null | undefined,
  isLoading: () => boolean = () => false,
): void {
  if (!vm || (typeof vm !== "object" && typeof vm !== "function")) return;
  if (installed.has(vm as unknown as object)) return;
  installed.add(vm as unknown as object);

  let changePending = false;
  const changed = (): void => {
    const runtime = vm.runtime;
    const target = runtime?.getTargetForStage?.();
    if (!target || isLoading() || changePending) return;
    changePending = true;
    // Combine synchronous changes without touching workspace XML. The snapshot
    // is captured synchronously at export, even if this notification is pending.
    queueMicrotask(() => {
      changePending = false;
      const currentRuntime = vm.runtime;
      if (!isLoading() && currentRuntime?.getTargetForStage?.() === target) {
        currentRuntime.emitProjectChanged?.();
      }
    });
  };

  const wrap = (name: string, prepare: (...args: never[]) => unknown[] | null): void => {
    const target = vm as unknown as Record<string, unknown>;
    if (typeof target[name] !== "function") return;
    const original = (target[name] as (...args: unknown[]) => unknown).bind(vm);
    target[name] = (...args: unknown[]) => {
      const next = prepare(...(args as never[]));
      if (!next) return undefined;
      const result = original(...next);
      changed();
      return result;
    };
  };

  wrap("setStageSize", (width: never, height: never) => {
    const runtime = vm.runtime;
    const next = stageDimensions(width, height);
    return next &&
      (!runtime || next[0] !== runtime.stageWidth || next[1] !== runtime.stageHeight)
      ? next
      : null;
  });
  wrap("setFramerate", (value: never) => {
    const runtime = vm.runtime;
    if (value === "" || !Number.isFinite(Number(value))) return null;
    const fps = Number(value) < 0 ? 1 : Math.min(250, Number(value));
    return !runtime?.frameLoop || fps !== runtime.frameLoop.framerate ? [fps] : null;
  });
  wrap("setTurboMode", (value: never) => {
    const runtime = vm.runtime;
    return !runtime || !!value !== runtime.turboMode ? [!!value] : null;
  });
  wrap("setInterpolation", (value: never) => {
    const runtime = vm.runtime;
    return !runtime || !!value !== runtime.interpolationEnabled ? [!!value] : null;
  });
  for (const [method, field] of [
    ["setRuntimeOptions", "runtimeOptions"],
    ["setCompilerOptions", "compilerOptions"],
  ] as const) {
    wrap(method, (options: never) => {
      const runtime = vm.runtime;
      return options && (!runtime || !sameOptions(runtime[field], options)) ? [options] : null;
    });
  }
}
