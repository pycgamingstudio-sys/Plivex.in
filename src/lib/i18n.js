// Hindi / English support.
// The chosen language is kept on this device. When Hindi is on, any text on screen that
// has an entry in src/lib/hi.js is shown in Hindi; everything else stays in English.
// The invoice preview / PDF is never translated, so invoices stay exactly as designed.
import hi from "@/lib/hi";

const KEY = "plivex:lang";
const SKIP = '.notranslate,[data-testid="invoice-preview"],script,style,textarea,input,select,code,pre';
const ATTRS = ["placeholder", "title", "aria-label"];

export const getLang = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setLang = (lang) => {
  try { localStorage.setItem(KEY, lang === "hi" ? "hi" : "en"); } catch { /* ignore */ }
  window.location.reload();
};

// Returns the Hindi text for an English string, or null when there is no translation.
export function translateText(text) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  const out = hi[clean];
  if (!out) return null;
  const lead = /^\s/.test(text) ? " " : "";
  const trail = /\s$/.test(text) ? " " : "";
  return lead + out + trail;
}

const skipped = (el) => !el || (el.closest && el.closest(SKIP));

function translateNode(node) {
  if (node.nodeType === 3) {
    if (skipped(node.parentElement)) return;
    const out = translateText(node.nodeValue);
    if (out !== null && out !== node.nodeValue) node.nodeValue = out;
  } else if (node.nodeType === 1) {
    if (skipped(node)) return;
    ATTRS.forEach((a) => {
      if (node.hasAttribute(a)) {
        const out = translateText(node.getAttribute(a));
        if (out !== null) node.setAttribute(a, out);
      }
    });
    node.childNodes.forEach(translateNode);
  }
}

let started = false;
export function startTranslator() {
  if (started || getLang() !== "hi") return;
  started = true;
  document.documentElement.lang = "hi";
  translateNode(document.body);
  let queued = new Set();
  let scheduled = false;
  const flush = () => { scheduled = false; const nodes = [...queued]; queued = new Set(); nodes.forEach((n) => { if (n.isConnected) translateNode(n); }); };
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "childList") m.addedNodes.forEach((n) => queued.add(n));
      else queued.add(m.target);
    }
    if (!scheduled) { scheduled = true; window.requestAnimationFrame(flush); }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
