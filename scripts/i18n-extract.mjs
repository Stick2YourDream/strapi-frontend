import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const traverse = traverseModule.default || traverseModule;
const SRC_DIR = path.resolve(__dirname, "../src");
const LOCALES_DIR = path.resolve(SRC_DIR, "i18n/locales");
const EN_PATH = path.resolve(LOCALES_DIR, "en.json");

const TRANSLATABLE_ATTRS = new Set([
  "placeholder",
  "title",
  "aria-label",
  "aria-placeholder",
  "alt",
]);

const UI_PROP_KEYS = new Set([
  "label",
  "title",
  "subtitle",
  "heading",
  "eyebrow",
  "description",
  "placeholder",
  "helper",
  "tooltip",
  "note",
  "message",
  "copy",
  "text",
  "cta",
  "button",
  "buttonLabel",
  "actionLabel",
  "emptyState",
  "status",
  "summary",
  "question",
  "answer",
]);

const UI_CALLEE_NAMES = new Set([
  "t",
  "alert",
  "confirm",
  "prompt",
  "toast",
  "notify",
  "showToast",
  "setError",
  "setSuccess",
  "setStatus",
  "setNotification",
  "setToast",
]);

const shouldInclude = (value) => {
  if (!value) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  if (value.length > 220) return false;
  return true;
};

const normalize = (value) => value.replace(/\s+/g, " ").trim();

const extractStaticString = (node) => {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked || "").join("");
  }
  return null;
};

const addKey = (keys, raw) => {
  const normalized = normalize(raw || "");
  if (!shouldInclude(normalized)) return;
  keys.add(normalized);
};

const parseFile = (code, filename, keys) => {
  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: [
        "typescript",
        "jsx",
        "classProperties",
        "decorators-legacy",
        "dynamicImport",
        "objectRestSpread",
        "optionalChaining",
        "nullishCoalescingOperator",
        "numericSeparator",
        "topLevelAwait",
      ],
    });
  } catch (error) {
    console.warn(`[i18n-extract] Skipping ${filename}: ${error.message}`);
    return;
  }

  traverse(ast, {
    JSXText(path) {
      addKey(keys, path.node.value);
    },
    JSXExpressionContainer(path) {
      const literal = extractStaticString(path.node.expression);
      if (literal) addKey(keys, literal);
    },
    JSXAttribute(path) {
      const attrName = path.node.name?.name;
      if (!TRANSLATABLE_ATTRS.has(attrName)) return;
      const valueNode = path.node.value;
      if (!valueNode) return;
      if (valueNode.type === "StringLiteral") {
        addKey(keys, valueNode.value);
        return;
      }
      if (valueNode.type === "JSXExpressionContainer") {
        const literal = extractStaticString(valueNode.expression);
        if (literal) addKey(keys, literal);
      }
    },
    ObjectProperty(path) {
      const key = path.node.key;
      const keyName =
        key.type === "Identifier"
          ? key.name
          : key.type === "StringLiteral"
            ? key.value
            : null;
      if (!keyName || !UI_PROP_KEYS.has(keyName)) return;
      const literal = extractStaticString(path.node.value);
      if (literal) addKey(keys, literal);
    },
    CallExpression(path) {
      const callee = path.node.callee;
      let calleeName = null;
      if (callee.type === "Identifier") {
        calleeName = callee.name;
      } else if (
        callee.type === "MemberExpression" &&
        callee.object.type === "Identifier"
      ) {
        if (callee.object.name === "toast") {
          calleeName = "toast";
        }
      }
      if (!calleeName || !UI_CALLEE_NAMES.has(calleeName)) return;
      const [firstArg] = path.node.arguments;
      const literal = extractStaticString(firstArg);
      if (literal) addKey(keys, literal);
    },
  });
};

const walk = async (dir, fileList = []) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "dist-ssg", "public"].includes(entry.name)) {
        continue;
      }
      await walk(fullPath, fileList);
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
};

const loadJson = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
};

const writeJson = async (filePath, data) => {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(filePath, content, "utf8");
};

const main = async () => {
  const keys = new Set();
  const files = await walk(SRC_DIR);
  for (const filePath of files) {
    const code = await fs.readFile(filePath, "utf8");
    parseFile(code, path.relative(SRC_DIR, filePath), keys);
  }

  const existing = await loadJson(EN_PATH);
  const merged = { ...existing };
  Array.from(keys)
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => {
      if (!merged[key]) merged[key] = key;
    });

  await writeJson(EN_PATH, merged);
  console.log(
    `[i18n-extract] Updated en.json with ${Object.keys(merged).length} keys.`
  );
};

await main();
