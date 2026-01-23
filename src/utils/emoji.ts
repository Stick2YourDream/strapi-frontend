type EmoticonRule = {
  pattern: RegExp;
  emoji: string;
};

const EMOTICON_RULES: EmoticonRule[] = [
  { pattern: /:\)/g, emoji: "\u{1F642}" }, // U+1F642
  { pattern: /:-\)/g, emoji: "\u{1F642}" }, // U+1F642
  { pattern: /:D/gi, emoji: "\u{1F604}" }, // U+1F604
  { pattern: /:-D/gi, emoji: "\u{1F604}" }, // U+1F604
  { pattern: /;\)/g, emoji: "\u{1F609}" }, // U+1F609
  { pattern: /;-\)/g, emoji: "\u{1F609}" }, // U+1F609
  { pattern: /:\(/g, emoji: "\u{1F641}" }, // U+1F641
  { pattern: /:-\(/g, emoji: "\u{1F641}" }, // U+1F641
  { pattern: /:'\(/g, emoji: "\u{1F622}" }, // U+1F622
  { pattern: /:P/gi, emoji: "\u{1F61B}" }, // U+1F61B
  { pattern: /:-P/gi, emoji: "\u{1F61B}" }, // U+1F61B
  { pattern: /:O/gi, emoji: "\u{1F62E}" }, // U+1F62E
  { pattern: /:-O/gi, emoji: "\u{1F62E}" }, // U+1F62E
  { pattern: /<3/g, emoji: "\u2764\uFE0F" }, // U+2764 + U+FE0F
];

const BLOCKED_EMOJI_PATTERNS: RegExp[] = [
  /\u{1F346}/gu, // U+1F346
  /\u{1F351}/gu, // U+1F351
  /\u{1F352}/gu, // U+1F352
  /\u{1F4A6}/gu, // U+1F4A6
  /\u{1F445}/gu, // U+1F445
  /\u{1FAE6}/gu, // U+1FAE6
  /\u{1F51E}/gu, // U+1F51E
  /\u{1F595}[\u{1F3FB}-\u{1F3FF}]?/gu, // U+1F595 (+ skin tone)
];

export const sanitizePostText = (value: string) => {
  let text = value;
  EMOTICON_RULES.forEach((rule) => {
    text = text.replace(rule.pattern, rule.emoji);
  });
  BLOCKED_EMOJI_PATTERNS.forEach((pattern) => {
    text = text.replace(pattern, "");
  });
  return text;
};
