import { RTL_LOCALES, TRANSLATIONS, translate } from "./translations";
import type { SupportedLocale, TranslationDict } from "./translations";

const ORIGINAL_TEXT = new WeakMap<Text, string>();
const ORIGINAL_ATTRS = new WeakMap<Element, Map<string, string>>();

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE"]);
const TRANSLATABLE_ATTRS = ["placeholder", "title", "aria-label", "aria-placeholder", "alt"];

let currentLocale: SupportedLocale = "en";
let reverseMap: Record<string, string> = {};

const buildReverseMap = (locale: SupportedLocale) => {
  const dict: TranslationDict = TRANSLATIONS[locale] || TRANSLATIONS.en;
  const map: Record<string, string> = {};
  Object.keys(dict).forEach((key) => {
    const translated = dict[key];
    if (translated && !map[translated]) {
      map[translated] = key;
    }
  });
  return map;
};

reverseMap = buildReverseMap(currentLocale);

const shouldSkipElement = (element: Element | null) => {
  if (!element) return true;
  if (SKIP_TAGS.has(element.tagName)) return true;
  if (element.closest("[data-i18n-skip=\"true\"]")) return true;
  return false;
};

const getOriginalText = (node: Text) => {
  if (!ORIGINAL_TEXT.has(node)) {
    const raw = node.nodeValue ?? "";
    if (currentLocale !== "en") {
      const trimmed = raw.trim();
      const mapped = reverseMap[trimmed];
      if (mapped) {
        const leading = raw.match(/^\s*/)?.[0] ?? "";
        const trailing = raw.match(/\s*$/)?.[0] ?? "";
        ORIGINAL_TEXT.set(node, `${leading}${mapped}${trailing}`);
      } else {
        ORIGINAL_TEXT.set(node, raw);
      }
    } else {
      ORIGINAL_TEXT.set(node, raw);
    }
  }
  return ORIGINAL_TEXT.get(node) ?? "";
};

const getOriginalAttrs = (element: Element) => {
  let stored = ORIGINAL_ATTRS.get(element);
  if (!stored) {
    stored = new Map();
    ORIGINAL_ATTRS.set(element, stored);
  }
  return stored;
};

const applyTextTranslation = (node: Text) => {
  const parent = node.parentElement;
  if (!parent || shouldSkipElement(parent)) return;
  const original = getOriginalText(node);
  const raw = original ?? "";
  if (!raw.trim()) {
    if (currentLocale === "en") node.nodeValue = original;
    return;
  }
  if (currentLocale === "en") {
    node.nodeValue = original;
    return;
  }
  const trimmed = raw.trim();
  const translated = translate(trimmed, currentLocale);
  if (!translated || translated === trimmed) {
    node.nodeValue = original;
    return;
  }
  const leading = raw.match(/^\s*/)?.[0] ?? "";
  const trailing = raw.match(/\s*$/)?.[0] ?? "";
  node.nodeValue = `${leading}${translated}${trailing}`;
};

const applyAttributeTranslation = (element: Element) => {
  if (shouldSkipElement(element)) return;
  const originals = getOriginalAttrs(element);
  TRANSLATABLE_ATTRS.forEach((attr) => {
    const current = element.getAttribute(attr);
    let original = originals.get(attr) ?? current ?? "";
    if (!originals.has(attr) && current) {
      if (currentLocale !== "en") {
        const mapped = reverseMap[current.trim()];
        if (mapped) {
          originals.set(attr, mapped);
          original = mapped;
        } else {
          originals.set(attr, current);
          original = current;
        }
      } else {
        originals.set(attr, current);
        original = current;
      }
    }
    if (!original) return;
    if (currentLocale === "en") {
      if (current !== original) element.setAttribute(attr, original);
      return;
    }
    const translated = translate(original.trim(), currentLocale);
    if (translated && translated !== original.trim()) {
      element.setAttribute(attr, translated);
    } else if (current !== original) {
      element.setAttribute(attr, original);
    }
  });
};

const translateTree = (root: Node) => {
  if (typeof document === "undefined") return;
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
  );
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      applyTextTranslation(node as Text);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      applyAttributeTranslation(node as Element);
    }
    node = walker.nextNode();
  }
};

const handleMutations = (mutations: MutationRecord[]) => {
  const targets = new Set<Node>();
  mutations.forEach((mutation) => {
    if (mutation.type === "characterData") {
      targets.add(mutation.target);
    } else if (mutation.type === "childList") {
      mutation.addedNodes.forEach((node) => targets.add(node));
    }
  });
  targets.forEach((node) => translateTree(node));
};

let observer: MutationObserver | null = null;

export const startAutoTranslate = () => {
  if (typeof document === "undefined") return;
  if (observer) return;
  observer = new MutationObserver(handleMutations);
  const root = document.body || document.documentElement;
  if (root) {
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    translateTree(root);
  }
};

export const updateAutoTranslateLocale = (locale: SupportedLocale) => {
  currentLocale = locale;
  reverseMap = buildReverseMap(locale);
  if (typeof document === "undefined") return;
  const root = document.body || document.documentElement;
  if (root) translateTree(root);
  document.documentElement.lang = locale;
  document.documentElement.dir = RTL_LOCALES.has(locale) ? "rtl" : "ltr";
};
