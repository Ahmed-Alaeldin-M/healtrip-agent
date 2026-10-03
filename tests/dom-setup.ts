import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000/", pretendToBeVisual: true });
const w = dom.window as unknown as Window & typeof globalThis;

const define = (key: string, value: unknown) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
define("window", w);
define("document", w.document);
define("navigator", w.navigator);
define("localStorage", w.localStorage);
define("sessionStorage", w.sessionStorage);
for (const k of ["HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "Event", "KeyboardEvent", "MouseEvent", "StorageEvent", "MutationObserver", "DOMException", "getComputedStyle"]) {
  define(k, (w as unknown as Record<string, unknown>)[k]);
}
(w.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
w.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof w.matchMedia;
define("IS_REACT_ACT_ENVIRONMENT", true);
export { w as jsdomWindow };
