import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";
import type { DialogOrigin, ToolRackDialogKind } from "./contracts";

let scrollLocks = 0;
let savedOverflow = "";
let savedPriority = "";

function lockScroll() {
  if (scrollLocks++ === 0) {
    savedOverflow = document.body.style.overflow;
    savedPriority = document.body.style.getPropertyPriority("overflow");
    document.body.style.setProperty("overflow", "hidden");
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--scrollLocks === 0) {
      if (savedOverflow) {
        document.body.style.setProperty("overflow", savedOverflow, savedPriority);
      } else {
        document.body.style.removeProperty("overflow");
      }
    }
  };
}

function visibilityStore() {
  let visible = false;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => visible,
    set(next: boolean) {
      if (next === visible) return;
      visible = next;
      listeners.forEach((listener) => listener());
    },
  };
}

function resolveOrigin(origin: DialogOrigin | undefined) {
  if (typeof origin === "function") return origin() ?? null;
  if (origin && "current" in origin) return origin.current ?? null;
  return origin ?? null;
}

function watchPanel(
  dialog: HTMLDialogElement,
  panelRef: RefObject<HTMLElement | null> | undefined,
  panelSelector: string | undefined,
  drawer: boolean,
) {
  dialog.dataset.trPlacement = drawer ? "drawer" : "workspace";
  if (drawer) return () => {};
  const panel = panelRef?.current ?? (panelSelector ? document.querySelector<HTMLElement>(panelSelector) : null);
  const update = () => {
    const bounds = panel?.getBoundingClientRect();
    const visible = panel && getComputedStyle(panel).display !== "none" && bounds;
    const offset = visible ? Math.max(0, Math.min(window.innerWidth, bounds.right)) : 0;
    dialog.style.setProperty("--tr-panel-offset", `${offset}px`);
  };
  update();
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
  if (panel) resize?.observe(panel);
  window.addEventListener("resize", update);
  return () => {
    resize?.disconnect();
    window.removeEventListener("resize", update);
    dialog.style.removeProperty("--tr-panel-offset");
  };
}

export type MotionOptions = {
  open?: boolean;
  origin?: DialogOrigin;
  kind?: ToolRackDialogKind;
  enterDuration?: number;
  panelRef?: RefObject<HTMLElement | null>;
  panelSelector?: string;
};

/**
 * Keeps a native dialog modal while an exit animation completes. The host
 * remains responsible for content state and close guards.
 */
export function useDialogMotion(
  ref: RefObject<HTMLDialogElement | null>,
  {
    open = true,
    origin,
    kind = "surface",
    enterDuration = 300,
    panelRef,
    panelSelector,
  }: MotionOptions = {},
) {
  const options = useRef({ origin, kind, enterDuration, panelRef, panelSelector });
  useLayoutEffect(() => {
    options.current = { origin, kind, enterDuration, panelRef, panelSelector };
  }, [origin, kind, enterDuration, panelRef, panelSelector]);
  const visibility = useMemo(visibilityStore, []);
  const visible = useSyncExternalStore(
    visibility.subscribe,
    visibility.getSnapshot,
    () => false,
  );
  const source = useRef<HTMLElement | null>(null);
  const animation = useRef<Animation | null>(null);
  const releaseScroll = useRef<(() => void) | null>(null);
  const stopPositioning = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const closing = useRef(false);

  const restingTransform = useCallback((dialog: HTMLDialogElement) => {
    const originElement = resolveOrigin(options.current.origin) || source.current;
    if (options.current.kind === "anchored" && originElement?.isConnected) {
      const target = originElement.getBoundingClientRect();
      const bounds = dialog.getBoundingClientRect();
      let left = Math.max(0, target.left);
      let top = Math.max(0, target.top);
      let right = Math.min(window.innerWidth, target.right);
      let bottom = Math.min(window.innerHeight, target.bottom);
      for (let parent = originElement.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const clip = parent.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(`${style.overflowX} ${style.overflowY}`)) {
          if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
            left = Math.max(left, clip.left);
            right = Math.min(right, clip.right);
          }
          if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
            top = Math.max(top, clip.top);
            bottom = Math.min(bottom, clip.bottom);
          }
        }
      }
      const width = right - left;
      const height = bottom - top;
      if (width > 0 && height > 0 && bounds.width && bounds.height) {
        return `translate(${left + width / 2 - (bounds.left + bounds.width / 2)}px, ${top + height / 2 - (bounds.top + bounds.height / 2)}px) scale(${width / bounds.width}, ${height / bounds.height})`;
      }
    }
    return options.current.kind === "drawer"
      ? "translateX(-24px) scale(0.98)"
      : "translateY(12px) scale(0.96)";
  }, []);

  const finish = useCallback(() => {
    const dialog = ref.current;
    animation.current?.cancel();
    animation.current = null;
    if (dialog?.open) dialog.close();
    stopPositioning.current?.();
    stopPositioning.current = null;
    if (dialog) delete dialog.dataset.trMotion;
    releaseScroll.current?.();
    releaseScroll.current = null;
    closing.current = false;
    visibility.set(false);
    const trigger = source.current;
    if (trigger?.isConnected && !trigger.closest("dialog:not([open])")) {
      trigger.focus({ preventScroll: true });
    }
  }, [ref, visibility]);

  const close = useCallback((afterClose?: () => void) => {
    const dialog = ref.current;
    if (!dialog?.open) {
      afterClose?.();
      return;
    }
    if (closing.current) return;
    closing.current = true;
    visibility.set(false);
    const current = getComputedStyle(dialog);
    const fromTransform = current.transform;
    const fromOpacity = current.opacity;
    animation.current?.cancel();
    dialog.dataset.trMotion = "closing";
    const token = ++generation.current;
    const done = () => {
      if (token !== generation.current) return;
      finish();
      afterClose?.();
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof dialog.animate !== "function") {
      done();
      return;
    }
    const exit = dialog.animate(
      [
        { transform: fromTransform, opacity: fromOpacity },
        { transform: restingTransform(dialog), opacity: 0 },
      ],
      { duration: 220, easing: "cubic-bezier(.4,0,1,1)", fill: "both" },
    );
    animation.current = exit;
    void exit.finished.then(done, () => {});
  }, [finish, ref, restingTransform, visibility]);

  const reopen = useCallback(() => {
    const dialog = ref.current;
    if (!dialog) return;
    ++generation.current;
    const wasOpen = dialog.open;
    const previous = wasOpen ? getComputedStyle(dialog).transform : null;
    const previousOpacity = wasOpen ? getComputedStyle(dialog).opacity : null;
    animation.current?.cancel();
    closing.current = false;
    stopPositioning.current?.();
    stopPositioning.current = watchPanel(
      dialog,
      options.current.panelRef,
      options.current.panelSelector,
      options.current.kind === "drawer",
    );
    if (!wasOpen) {
      source.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof dialog.showModal === "function") {
        try {
          dialog.showModal();
        } catch {
          // A host may have opened the element non-modally before the hook ran.
          dialog.setAttribute("open", "");
        }
      } else dialog.setAttribute("open", "");
      releaseScroll.current = lockScroll();
    }
    dialog.dataset.trMotion = "opening";
    visibility.set(false);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof dialog.animate !== "function") {
      dialog.dataset.trMotion = "open";
      visibility.set(true);
      return;
    }
    const entrance = dialog.animate(
      [
        { transform: previous || restingTransform(dialog), opacity: previousOpacity || 0 },
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
      ],
      { duration: options.current.enterDuration, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" },
    );
    animation.current = entrance;
    void entrance.finished.then(() => {
      if (animation.current === entrance) {
        entrance.cancel();
        animation.current = null;
        visibility.set(true);
      }
    }, () => {});
  }, [ref, restingTransform, visibility]);

  useEffect(() => {
    if (open) reopen();
    else close();
  }, [open, close, reopen]);

  useEffect(() => () => {
    ++generation.current;
    finish();
  }, [finish]);

  useEffect(() => {
    const dialog = ref.current;
    const revealed = (event: AnimationEvent) => {
      if (event.animationName === "tr-dialog-content-in" && dialog?.dataset.trMotion === "opening") {
        dialog.dataset.trMotion = "open";
      }
    };
    dialog?.addEventListener("animationend", revealed);
    return () => dialog?.removeEventListener("animationend", revealed);
  }, [open, ref]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => {
      if (!preference.matches) return;
      animation.current?.finish();
      if (ref.current?.dataset.trMotion === "opening") {
        ref.current.dataset.trMotion = "open";
        visibility.set(true);
      }
    };
    preference.addEventListener("change", changed);
    return () => preference.removeEventListener("change", changed);
  }, [ref, visibility]);

  return { close, reopen, visible };
}
