import { vi } from "vitest";

/** jsdom lacks the browser dialog, media-query and animation APIs. */
export function installGuideBrowserAPIs() {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, writable: true, value: vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
    this.querySelector<HTMLButtonElement>("button")?.focus();
  }) });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, writable: true, value: vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); }) });
  Object.defineProperty(Element.prototype, "animate", { configurable: true, writable: true, value: vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn(), finish: vi.fn() })) });
}
