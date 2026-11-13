export type HostNode = {
  kind: "host";
  tag: string;
  props: Record<string, unknown>;
  children: RenderedNode[];
};

export type TextNode = {
  kind: "text";
  text: string;
};

export type RenderedNode = HostNode | TextNode;

export type VElement = {
  $$typeof: symbol;
  type: unknown;
  key: string | null;
  props: Record<string, unknown>;
};

type StateSlot = {
  kind: "state";
  value: unknown;
  pendingValue: unknown;
};

type RefSlot = {
  kind: "ref";
  ref: { current: unknown };
};

type EffectSlot = {
  kind: "effect";
  deps: unknown[] | undefined;
  create: () => void | (() => void);
  cleanup: (() => void) | undefined;
  pending: boolean;
};

type HookSlot = StateSlot | RefSlot | EffectSlot;

type ContextObj<T = unknown> = {
  _defaultValue: T;
  _stack: T[];
  Provider: ((props: { value: T; children?: unknown }) => unknown) & {
    __context: ContextObj<T>;
  };
};

type MountedNode = {
  kind: "component" | "provider" | "host" | "fragment" | "text";
  type: unknown;
  key: string | null;
  props: Record<string, unknown>;
  hooks: HookSlot[];
  children: MountedNode[];
  text: string;
  unmounted: boolean;
};

const ELEMENT_SYMBOL = Symbol.for("react.transitional.element");
const FRAGMENT_SYMBOL = Symbol.for("react.fragment");

function isElement(value: unknown): value is VElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "$$typeof" in value &&
    (value as VElement).$$typeof === ELEMENT_SYMBOL
  );
}

function isProviderType(type: unknown): type is ContextObj["Provider"] {
  return typeof type === "function" && "__context" in type;
}

function flattenChildren(input: unknown, out: unknown[] = []): unknown[] {
  if (input === null || input === undefined || typeof input === "boolean") {
    return out;
  }
  if (Array.isArray(input)) {
    for (const item of input) flattenChildren(item, out);
    return out;
  }
  out.push(input);
  return out;
}

function depsEqual(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

export function jsxElement(
  type: unknown,
  rawProps: Record<string, unknown> | null,
  key?: unknown,
): VElement {
  const props = rawProps ? { ...rawProps } : {};
  const resolvedKey =
    key !== undefined && key !== null
      ? String(key)
      : props.key !== undefined && props.key !== null
        ? String(props.key)
        : null;
  if ("key" in props) delete props.key;
  return {
    $$typeof: ELEMENT_SYMBOL,
    type,
    key: resolvedKey,
    props,
  };
}

export function createElement(
  type: unknown,
  rawProps: Record<string, unknown> | null,
  ...children: unknown[]
): VElement {
  const props = rawProps ? { ...rawProps } : {};
  const resolvedKey =
    props.key !== undefined && props.key !== null ? String(props.key) : null;
  if ("key" in props) delete props.key;
  if (children.length === 1) {
    props.children = children[0];
  } else if (children.length > 1) {
    props.children = children;
  }
  return {
    $$typeof: ELEMENT_SYMBOL,
    type,
    key: resolvedKey,
    props,
  };
}

export function createReactTestRuntime() {
  let activeNode: MountedNode | null = null;
  let hookCursor = 0;
  let rootNode: MountedNode | null = null;
  let rootElement: VElement | null = null;
  let dirty = false;
  let flushScheduled = false;

  function scheduleRender() {
    dirty = true;
    if (!flushScheduled) {
      flushScheduled = true;
      Promise.resolve().then(() => {
        flushScheduled = false;
        if (rootElement && dirty) runSyncFlush();
      });
    }
  }

  function createContext<T>(defaultValue: T): ContextObj<T> {
    const context: ContextObj<T> = {
      _defaultValue: defaultValue,
      _stack: [],
      Provider: Object.assign(
        ({ children }: { value: T; children?: unknown }) => children,
        { __context: null as unknown as ContextObj<T> },
      ),
    };
    context.Provider.__context = context;
    return context;
  }

  function useContext<T>(context: ContextObj<T>): T {
    if (context._stack.length > 0) {
      return context._stack[context._stack.length - 1];
    }
    return context._defaultValue;
  }

  function useState<T>(
    initial: T | (() => T),
  ): [T, (next: T | ((prev: T) => T)) => void] {
    const node = activeNode;
    if (!node) throw new Error("useState called outside component render");
    const index = hookCursor++;
    let slot = node.hooks[index] as StateSlot | undefined;
    if (!slot) {
      const value =
        typeof initial === "function" ? (initial as () => T)() : initial;
      slot = { kind: "state", value, pendingValue: value };
      node.hooks[index] = slot;
    }
    const capturedSlot = slot;
    const setState = (nextOrUpdater: T | ((prev: T) => T)) => {
      if (node.unmounted) return;
      const next =
        typeof nextOrUpdater === "function"
          ? (nextOrUpdater as (prev: T) => T)(capturedSlot.pendingValue as T)
          : nextOrUpdater;
      capturedSlot.pendingValue = next;
      if (!Object.is(capturedSlot.value, next)) {
        scheduleRender();
      }
    };
    return [slot.value as T, setState];
  }

  function useRef<T>(initial: T): { current: T } {
    const node = activeNode;
    if (!node) throw new Error("useRef called outside component render");
    const index = hookCursor++;
    let slot = node.hooks[index] as RefSlot | undefined;
    if (!slot) {
      slot = { kind: "ref", ref: { current: initial } };
      node.hooks[index] = slot;
    }
    return slot.ref as { current: T };
  }

  function useEffect(create: () => void | (() => void), deps?: unknown[]) {
    const node = activeNode;
    if (!node) throw new Error("useEffect called outside component render");
    const index = hookCursor++;
    let slot = node.hooks[index] as EffectSlot | undefined;
    if (!slot) {
      slot = {
        kind: "effect",
        deps,
        create,
        cleanup: undefined,
        pending: true,
      };
      node.hooks[index] = slot;
      return;
    }
    const changed = !depsEqual(slot.deps, deps);
    slot.create = create;
    slot.deps = deps;
    if (changed) slot.pending = true;
  }

  function unmountNode(node: MountedNode) {
    if (node.unmounted) return;
    node.unmounted = true;
    for (const child of node.children) unmountNode(child);
    node.children = [];
    for (const slot of node.hooks) {
      if (slot.kind === "effect" && slot.cleanup) {
        const fn = slot.cleanup;
        slot.cleanup = undefined;
        fn();
      }
    }
  }

  function reconcileChildList(
    oldChildren: MountedNode[],
    rawChildren: unknown,
  ): MountedNode[] {
    const flat = flattenChildren(rawChildren);
    const keyedOld = new Map<string, MountedNode>();
    const unkeyedOld = new Map<number, MountedNode>();
    oldChildren.forEach((child, index) => {
      if (child.key !== null) {
        keyedOld.set(child.key, child);
      } else {
        unkeyedOld.set(index, child);
      }
    });

    const used = new Set<MountedNode>();
    const nextNodes: MountedNode[] = [];

    flat.forEach((item, index) => {
      if (typeof item === "string" || typeof item === "number") {
        const candidate = unkeyedOld.get(index);
        if (candidate && candidate.kind === "text" && !used.has(candidate)) {
          used.add(candidate);
          candidate.text = String(item);
          nextNodes.push(candidate);
        } else {
          nextNodes.push({
            kind: "text",
            type: "#text",
            key: null,
            props: {},
            hooks: [],
            children: [],
            text: String(item),
            unmounted: false,
          });
        }
        return;
      }

      if (!isElement(item)) return;

      const candidate =
        item.key !== null ? keyedOld.get(item.key) : unkeyedOld.get(index);

      let node: MountedNode;
      if (
        candidate &&
        !used.has(candidate) &&
        candidate.type === item.type &&
        candidate.key === item.key
      ) {
        used.add(candidate);
        node = candidate;
        node.props = item.props;
      } else {
        const kind: MountedNode["kind"] =
          item.type === FRAGMENT_SYMBOL
            ? "fragment"
            : isProviderType(item.type)
              ? "provider"
              : typeof item.type === "function"
                ? "component"
                : "host";
        node = {
          kind,
          type: item.type,
          key: item.key,
          props: item.props,
          hooks: [],
          children: [],
          text: "",
          unmounted: false,
        };
      }

      renderNode(node);
      nextNodes.push(node);
    });

    for (const oldChild of oldChildren) {
      if (!used.has(oldChild)) unmountNode(oldChild);
    }

    return nextNodes;
  }

  function renderNode(node: MountedNode) {
    if (node.kind === "text") return;

    if (node.kind === "fragment" || node.kind === "host") {
      node.children = reconcileChildList(node.children, node.props.children);
      return;
    }

    if (node.kind === "provider") {
      const providerType = node.type as ContextObj["Provider"];
      const ctx = providerType.__context;
      ctx._stack.push(node.props.value);
      try {
        node.children = reconcileChildList(node.children, node.props.children);
      } finally {
        ctx._stack.pop();
      }
      return;
    }

    for (const slot of node.hooks) {
      if (slot.kind === "state") {
        slot.value = slot.pendingValue;
      }
    }

    const prevNode = activeNode;
    const prevCursor = hookCursor;
    activeNode = node;
    hookCursor = 0;
    let rendered: unknown;
    try {
      const fn = node.type as (props: Record<string, unknown>) => unknown;
      rendered = fn(node.props);
    } finally {
      activeNode = prevNode;
      hookCursor = prevCursor;
    }
    node.children = reconcileChildList(node.children, rendered);
  }

  function collectEffects(
    node: MountedNode,
    out: { node: MountedNode; slot: EffectSlot }[],
  ) {
    if (node.unmounted) return;
    for (const child of node.children) collectEffects(child, out);
    for (const slot of node.hooks) {
      if (slot.kind === "effect" && slot.pending) {
        out.push({ node, slot });
      }
    }
  }

  function runSyncFlush() {
    if (!rootElement) return;
    for (let pass = 0; pass < 50; pass += 1) {
      dirty = false;
      if (
        !rootNode ||
        rootNode.type !== rootElement.type ||
        rootNode.key !== rootElement.key
      ) {
        if (rootNode) unmountNode(rootNode);
        rootNode = {
          kind:
            rootElement.type === FRAGMENT_SYMBOL
              ? "fragment"
              : isProviderType(rootElement.type)
                ? "provider"
                : typeof rootElement.type === "function"
                  ? "component"
                  : "host",
          type: rootElement.type,
          key: rootElement.key,
          props: rootElement.props,
          hooks: [],
          children: [],
          text: "",
          unmounted: false,
        };
      } else {
        rootNode.props = rootElement.props;
      }

      renderNode(rootNode);

      const effects: { node: MountedNode; slot: EffectSlot }[] = [];
      collectEffects(rootNode, effects);
      for (const { node, slot } of effects) {
        if (node.unmounted) continue;
        slot.pending = false;
        if (slot.cleanup) {
          const prevCleanup = slot.cleanup;
          slot.cleanup = undefined;
          prevCleanup();
        }
        const cleanup = slot.create();
        if (typeof cleanup === "function") {
          slot.cleanup = cleanup;
        }
      }

      if (!dirty) return;
    }
    throw new Error("Exceeded maximum render passes in React test runtime");
  }

  function toRenderedNodes(node: MountedNode | null): RenderedNode[] {
    if (!node || node.unmounted) return [];
    if (node.kind === "text") return [{ kind: "text", text: node.text }];
    if (node.kind === "host") {
      return [
        {
          kind: "host",
          tag: String(node.type),
          props: node.props,
          children: node.children.flatMap((child) => toRenderedNodes(child)),
        },
      ];
    }
    return node.children.flatMap((child) => toRenderedNodes(child));
  }

  async function flush() {
    for (let i = 0; i < 20; i += 1) {
      if (dirty) {
        runSyncFlush();
      }
      await Promise.resolve();
      if (!dirty && !flushScheduled) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (!dirty && !flushScheduled) break;
      }
    }
  }

  async function mount(element: VElement) {
    rootElement = element;
    dirty = true;
    await flush();
  }

  async function rerender(element: VElement) {
    rootElement = element;
    dirty = true;
    await flush();
  }

  function unmount() {
    if (rootNode) {
      unmountNode(rootNode);
      rootNode = null;
    }
    rootElement = null;
    dirty = false;
    flushScheduled = false;
  }

  function getTree(): HostNode {
    return {
      kind: "host",
      tag: "root",
      props: {},
      children: toRenderedNodes(rootNode),
    };
  }

  const reactMock = {
    Fragment: FRAGMENT_SYMBOL,
    createContext,
    useContext,
    useState,
    useRef,
    useEffect,
    createElement,
  };

  const jsxRuntimeMock = {
    Fragment: FRAGMENT_SYMBOL,
    jsx: jsxElement,
    jsxs: jsxElement,
    jsxDEV: jsxElement,
  };

  return {
    reactMock,
    jsxRuntimeMock,
    mount,
    rerender,
    unmount,
    flush,
    getTree,
  };
}

export function getTextContent(node: RenderedNode): string {
  if (node.kind === "text") return node.text;
  return node.children.map(getTextContent).join("");
}

export function findHostNodes(
  root: HostNode,
  predicate: (node: HostNode) => boolean,
): HostNode[] {
  const matches: HostNode[] = [];
  function visit(node: RenderedNode) {
    if (node.kind !== "host") return;
    if (predicate(node)) matches.push(node);
    for (const child of node.children) visit(child);
  }
  visit(root);
  return matches;
}

export function findByRole(root: HostNode, role: string): HostNode[] {
  return findHostNodes(root, (node) => node.props.role === role);
}

export function findButtons(
  root: HostNode,
  labelOrPattern?: string | RegExp,
): HostNode[] {
  return findHostNodes(root, (node) => {
    if (node.tag !== "button") return false;
    if (!labelOrPattern) return true;
    const text = getTextContent(node).trim();
    const ariaLabel =
      typeof node.props["aria-label"] === "string"
        ? node.props["aria-label"]
        : "";
    if (typeof labelOrPattern === "string") {
      return text === labelOrPattern || ariaLabel === labelOrPattern;
    }
    return labelOrPattern.test(text) || labelOrPattern.test(ariaLabel);
  });
}

export function clickButton(button: HostNode): unknown {
  if (button.props.disabled) {
    throw new Error(
      `Cannot click disabled button "${getTextContent(button).trim()}"`,
    );
  }
  const onClick = button.props.onClick;
  if (typeof onClick !== "function") {
    throw new Error(
      `Button "${getTextContent(button).trim()}" has no onClick handler`,
    );
  }
  return (onClick as () => unknown)();
}

export function createMemoryStorage(initial?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    store,
    storage: {
      get length() {
        return store.size;
      },
      clear() {
        store.clear();
      },
      getItem(key: string) {
        return store.has(key) ? store.get(key)! : null;
      },
      key(index: number) {
        return [...store.keys()][index] ?? null;
      },
      removeItem(key: string) {
        store.delete(key);
      },
      setItem(key: string, value: string) {
        store.set(key, String(value));
      },
    } satisfies Storage,
  };
}

export function createWindowEventMock() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    window: {
      addEventListener(type: string, listener: (event: unknown) => void) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      removeEventListener(type: string, listener: (event: unknown) => void) {
        listeners.get(type)?.delete(listener);
      },
      dispatchStorageEvent(key: string | null) {
        const set = listeners.get("storage");
        if (!set) return;
        for (const listener of [...set]) {
          listener({ type: "storage", key });
        }
      },
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const reactTestRuntime = createReactTestRuntime();
