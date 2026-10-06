/**
 * Minimal JSONC reader that keeps byte offsets, so edits can be applied to the
 * original text and every comment and blank line outside the edited value
 * survives untouched.
 */

export interface JsoncMember {
  key: string;
  keyStart: number;
  keyEnd: number;
  value: JsoncNode;
  /** Member span: key start through value end. */
  start: number;
  end: number;
}

export type JsoncObject = { type: "object"; start: number; end: number; members: JsoncMember[] };

export type JsoncNode =
  | JsoncObject
  | { type: "array"; start: number; end: number; elements: JsoncNode[] }
  | { type: "string"; start: number; end: number; value: string }
  | { type: "number"; start: number; end: number; value: number }
  | { type: "literal"; start: number; end: number; value: boolean | null };

export class JsoncParseError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`${message} (offset ${offset})`);
    this.name = "JsoncParseError";
    this.offset = offset;
  }
}

const WHITESPACE = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);

class Parser {
  private index = 0;

  constructor(private readonly text: string) {}

  parse(): JsoncNode {
    this.skipTrivia();
    const node = this.parseValue();
    this.skipTrivia();
    if (this.index !== this.text.length) {
      throw new JsoncParseError("Unexpected trailing content", this.index);
    }
    return node;
  }

  private skipTrivia(): void {
    const text = this.text;
    while (this.index < text.length) {
      const char = text[this.index];
      if (WHITESPACE.has(char)) {
        this.index += 1;
        continue;
      }
      if (char === "/" && text[this.index + 1] === "/") {
        const newline = text.indexOf("\n", this.index + 2);
        this.index = newline === -1 ? text.length : newline + 1;
        continue;
      }
      if (char === "/" && text[this.index + 1] === "*") {
        const close = text.indexOf("*/", this.index + 2);
        if (close === -1) {
          throw new JsoncParseError("Unterminated block comment", this.index);
        }
        this.index = close + 2;
        continue;
      }
      return;
    }
  }

  private parseValue(): JsoncNode {
    const char = this.text[this.index];
    if (char === undefined) {
      throw new JsoncParseError("Unexpected end of input", this.index);
    }
    if (char === "{") return this.parseObject();
    if (char === "[") return this.parseArray();
    if (char === '"') return this.parseString();
    if (char === "t" || char === "f" || char === "n") return this.parseLiteral();
    return this.parseNumber();
  }

  private parseObject(): JsoncNode {
    const start = this.index;
    this.index += 1;
    const members: JsoncMember[] = [];
    for (;;) {
      this.skipTrivia();
      const char = this.text[this.index];
      if (char === undefined) {
        throw new JsoncParseError("Unterminated object", start);
      }
      if (char === "}") {
        const end = this.index + 1;
        this.index = end;
        return { type: "object", start, end, members };
      }
      if (char === ",") {
        this.index += 1;
        continue;
      }
      if (char !== '"') {
        throw new JsoncParseError("Expected a quoted object key", this.index);
      }
      const key = this.parseString();
      this.skipTrivia();
      if (this.text[this.index] !== ":") {
        throw new JsoncParseError("Expected ':' after object key", this.index);
      }
      this.index += 1;
      this.skipTrivia();
      const value = this.parseValue();
      members.push({
        key: key.value,
        keyStart: key.start,
        keyEnd: key.end,
        value,
        start: key.start,
        end: value.end,
      });
    }
  }

  private parseArray(): JsoncNode {
    const start = this.index;
    this.index += 1;
    const elements: JsoncNode[] = [];
    for (;;) {
      this.skipTrivia();
      const char = this.text[this.index];
      if (char === undefined) {
        throw new JsoncParseError("Unterminated array", start);
      }
      if (char === "]") {
        const end = this.index + 1;
        this.index = end;
        return { type: "array", start, end, elements };
      }
      if (char === ",") {
        this.index += 1;
        continue;
      }
      elements.push(this.parseValue());
    }
  }

  private parseString(): { type: "string"; start: number; end: number; value: string } {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      if (escaped) {
        escaped = false;
        this.index += 1;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        this.index += 1;
        continue;
      }
      if (char === '"') {
        const end = this.index + 1;
        const raw = this.text.slice(start, end);
        this.index = end;
        return { type: "string", start, end, value: JSON.parse(raw) as string };
      }
      this.index += 1;
    }
    throw new JsoncParseError("Unterminated string", start);
  }

  private parseNumber(): JsoncNode {
    const start = this.index;
    while (this.index < this.text.length && /[0-9eE+\-.]/.test(this.text[this.index])) {
      this.index += 1;
    }
    const raw = this.text.slice(start, this.index);
    const value = Number(raw);
    if (raw.length === 0 || Number.isNaN(value)) {
      throw new JsoncParseError("Expected a value", start);
    }
    return { type: "number", start, end: this.index, value };
  }

  private parseLiteral(): JsoncNode {
    const start = this.index;
    for (const [word, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (this.text.startsWith(word, start)) {
        this.index = start + word.length;
        return { type: "literal", start, end: this.index, value };
      }
    }
    throw new JsoncParseError("Expected a value", start);
  }
}

export function parseJsonc(text: string): JsoncNode {
  return new Parser(text).parse();
}

export function memberOf(node: JsoncNode, key: string): JsoncMember | null {
  if (node.type !== "object") return null;
  return node.members.find((member) => member.key === key) ?? null;
}

/** Walk object members by key. Returns null when any step is missing or not an object. */
export function objectAt(root: JsoncNode, path: readonly string[]): JsoncObject | null {
  let current: JsoncNode = root;
  for (const key of path) {
    const member = memberOf(current, key);
    if (!member) return null;
    current = member.value;
  }
  return current.type === "object" ? current : null;
}

function lineIndent(text: string, position: number): string {
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  const prefix = text.slice(lineStart, position);
  return /^[ \t]*$/.test(prefix) ? prefix : "";
}

function indentUnit(text: string): string {
  for (const line of text.split("\n")) {
    const match = /^([ \t]+)\S/.exec(line);
    if (match && match[1].length <= 8) return match[1];
  }
  return "  ";
}

function nextSignificant(text: string, position: number): number {
  let index = position;
  while (index < text.length) {
    const char = text[index];
    if (WHITESPACE.has(char)) {
      index += 1;
      continue;
    }
    if (char === "/" && text[index + 1] === "/") {
      const newline = text.indexOf("\n", index + 2);
      index = newline === -1 ? text.length : newline + 1;
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      const close = text.indexOf("*/", index + 2);
      index = close === -1 ? text.length : close + 2;
      continue;
    }
    return index;
  }
  return text.length;
}

export interface JsoncEditResult {
  text: string;
  changed: boolean;
}

/**
 * Set one member of the object at `path` to `rawValue` (already-serialized JSON).
 * Existing members keep their position and surrounding comments; a missing member
 * is appended to the object with the file's own indentation.
 */
export function setMemberValue(
  text: string,
  path: readonly string[],
  key: string,
  rawValue: string,
): JsoncEditResult {
  const root = parseJsonc(text);
  const target = path.length === 0 ? root : objectAt(root, path);
  if (!target || target.type !== "object") {
    throw new JsoncParseError(`No object at ${path.join(".") || "<root>"}`, 0);
  }

  const existing = memberOf(target, key);
  if (existing) {
    if (text.slice(existing.value.start, existing.value.end) === rawValue) {
      return { text, changed: false };
    }
    return {
      text: text.slice(0, existing.value.start) + rawValue + text.slice(existing.value.end),
      changed: true,
    };
  }

  const last = target.members[target.members.length - 1];
  const unit = indentUnit(text);
  if (!last) {
    const childIndent = lineIndent(text, target.start) + unit;
    const closeIndent = lineIndent(text, target.start);
    const insertAt = target.start + 1;
    const insertion = `\n${childIndent}${JSON.stringify(key)}: ${rawValue}\n${closeIndent}`;
    return { text: text.slice(0, insertAt) + insertion + text.slice(insertAt), changed: true };
  }

  const indent = lineIndent(text, last.start) || lineIndent(text, target.start) + unit;
  const needsComma = text[nextSignificant(text, last.end)] !== ",";
  const insertion = `${needsComma ? "," : ""}\n${indent}${JSON.stringify(key)}: ${rawValue}`;
  const insertAt = last.end;
  return { text: text.slice(0, insertAt) + insertion + text.slice(insertAt), changed: true };
}
