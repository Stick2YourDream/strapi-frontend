import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC_DIR = path.resolve(__dirname, "../src");
const LOCALES_DIR = path.resolve(SRC_DIR, "i18n/locales");

const DEFAULT_API_URL =
  process.env.TRANSLATE_API_URL || "https://libretranslate.de/translate";
const API_KEY = process.env.TRANSLATE_API_KEY || "";
const SOURCE_LOCALE = "en";
const DELAY_MS = Number(process.env.TRANSLATE_DELAY_MS || "350");
const MAX_PER_LOCALE = Number(process.env.TRANSLATE_MAX || "0");
const TIMEOUT_MS = Number(process.env.TRANSLATE_TIMEOUT_MS || "12000");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const loadJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
};

const writeJson = async (filePath, data) => {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(filePath, content, "utf8");
};

const tokenizeTemplate = (text) => {
  const tokens = [];
  const tokenized = text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
    const index = tokens.length;
    tokens.push(name);
    return `__VAR_${index}__`;
  });
  return { tokenized, tokens };
};

const detokenizeTemplate = (text, tokens) =>
  tokens.reduce(
    (acc, name, index) => acc.replaceAll(`__VAR_${index}__`, `{{${name}}}`),
    text
  );

const translateText = async (text, target) => {
  const { tokenized, tokens } = tokenizeTemplate(text);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(DEFAULT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        q: tokenized,
        source: SOURCE_LOCALE,
        target,
        format: "text",
        api_key: API_KEY || undefined,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Translate timeout after ${TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const responseText = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Translate failed (${response.status}): ${responseText}`);
  }
  if (responseText.trim().startsWith("<!DOCTYPE html")) {
    throw new Error(
      "Translate failed (HTML response). Provide a working LibreTranslate API URL/key."
    );
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (error) {
    throw new Error(`Translate failed (invalid JSON): ${responseText.slice(0, 120)}`);
  }
  const translated =
    data?.translatedText ||
    data?.translated_text ||
    data?.[0]?.translatedText ||
    "";
  if (!translated) return text;
  return detokenizeTemplate(translated, tokens);
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const localeArg = args.find((arg) => arg.startsWith("--locales="));
  const singleLocale = args.find((arg) => arg.startsWith("--locale="));
  const locales =
    (localeArg && localeArg.split("=")[1]) ||
    (singleLocale && singleLocale.split("=")[1]) ||
    process.env.TRANSLATE_LOCALES ||
    "";
  const list = locales
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return list;
};

const main = async () => {
  const selectedLocales = parseArgs();
  const localeFiles = await fs.readdir(LOCALES_DIR);
  const availableLocales = localeFiles
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(".json", ""))
    .filter((locale) => locale !== SOURCE_LOCALE);

  const locales =
    selectedLocales.length > 0
      ? selectedLocales.filter((locale) => availableLocales.includes(locale))
      : availableLocales;

  if (locales.length === 0) {
    console.log("[i18n-translate] No locales to translate.");
    return;
  }

  const enPath = path.resolve(LOCALES_DIR, "en.json");
  const enDict = await loadJson(enPath);
  const keys = Object.keys(enDict);

  for (const locale of locales) {
    const localePath = path.resolve(LOCALES_DIR, `${locale}.json`);
    const dict = await loadJson(localePath);
    let translatedCount = 0;
    let processedCount = 0;

    for (const key of keys) {
      if (MAX_PER_LOCALE && processedCount >= MAX_PER_LOCALE) break;
      const existing = dict[key];
      if (existing && existing !== key) continue;
      const value = enDict[key] ?? key;
      try {
        const translated = await translateText(value, locale);
        dict[key] = translated || value;
        translatedCount += 1;
        processedCount += 1;
        await sleep(DELAY_MS);
      } catch (error) {
        console.warn(
          `[i18n-translate] ${locale} failed for "${key}": ${error.message}`
        );
        processedCount += 1;
        await sleep(DELAY_MS * 2);
      }
    }

    await writeJson(localePath, dict);
    console.log(
      `[i18n-translate] ${locale}: updated ${translatedCount} entries.`
    );
  }
};

await main();
