/**
 * Owns the TurboWarp runtime subscriptions used by the 3D stage.
 *
 * Binding tracks both the VM and its runtime so replacing either cannot
 * leave stale tick listeners behind.
 */

type Listener = (...args: unknown[]) => void;

interface Emitter {
  on?: (event: string, handler: Listener) => void;
  off?: (event: string, handler: Listener) => void;
  removeListener?: (event: string, handler: Listener) => void;
}

export interface Runtime3DBridgeHandlers {
  onStart?: Listener;
  onStop?: Listener;
  onTick?: Listener;
  onChange?: Listener;
}

type Subscription = [Emitter, string, Listener];

const listen = (
  emitter: Emitter | null | undefined,
  event: string,
  handler: Listener | undefined,
  subscriptions: Subscription[],
): void => {
  if (!handler || typeof emitter?.on !== "function") return;
  emitter.on(event, handler);
  subscriptions.push([emitter, event, handler]);
};

const unlisten = ([emitter, event, handler]: Subscription): void => {
  if (typeof emitter?.off === "function") emitter.off(event, handler);
  else if (typeof emitter?.removeListener === "function") {
    emitter.removeListener(event, handler);
  }
};

export class Runtime3DBridge {
  private handlers: Runtime3DBridgeHandlers;
  private subscriptions: Subscription[] = [];
  vm: Emitter | null = null;
  runtime: Emitter | null = null;

  constructor(handlers: Runtime3DBridgeHandlers = {}) {
    this.handlers = handlers;
  }

  bind(vm: Emitter | null): boolean {
    const runtime = (vm as { runtime?: Emitter } | null)?.runtime || null;
    if (this.vm === vm && this.runtime === runtime) return false;

    this.detach();
    this.vm = vm || null;
    this.runtime = runtime;

    const subscriptions = this.subscriptions;
    const { onStart, onStop, onTick, onChange } = this.handlers;
    for (const event of ["PROJECT_RUN_START", "RUNTIME_STARTED"]) {
      listen(this.vm, event, onStart, subscriptions);
    }
    for (const event of ["PROJECT_RUN_STOP", "RUNTIME_STOPPED"]) {
      listen(this.vm, event, onStop, subscriptions);
    }
    for (const event of ["PROJECT_CHANGED", "TARGETS_UPDATE"]) {
      listen(this.vm, event, onChange, subscriptions);
    }
    listen(this.runtime, "AFTER_EXECUTE", onTick, subscriptions);
    return true;
  }

  detach(): void {
    for (const subscription of this.subscriptions) unlisten(subscription);
    this.subscriptions.length = 0;
    this.vm = null;
    this.runtime = null;
  }
}
