/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { createHash } from "node:crypto";

const MAX_INPUT_BYTES = 262_144;
const MAX_INPUT_NODES = 10_000;
const MAX_INPUT_DEPTH = 64;
const DISPLAY_ACTIONS = new Set([
  "read",
  "write",
  "append",
  "delete",
  "list",
  "inspect",
  "rename",
  "move",
  "copy",
  "execute",
  "submit",
  "upload",
  "download",
  "open",
  "click",
  "scroll",
  "type",
  "capture",
  "select",
  "query",
  "get",
  "set",
  "send",
  "publish",
  "purchase",
]);

/** Complete JSON identity stays in the digest; caller strings/names stay local. */
export function createManagedArgumentsSummary(input: unknown): string {
  const canonical = canonicalInput(input);
  const digest = createHash("sha256").update(canonical).digest("hex");
  const fields: Record<string, string> = {
    input_digest: digest,
    type: input === null ? "null" : Array.isArray(input) ? "array" : typeof input,
  };
  if (Array.isArray(input)) fields.length = String(input.length);
  else if (input !== null && typeof input === "object") {
    const record = input as Record<string, unknown>;
    fields.field_count = String(Object.keys(record).length);
    for (const key of ["action", "operation"]) {
      if (!Object.hasOwn(record, key)) continue;
      const value = record[key];
      if (typeof value === "string" && DISPLAY_ACTIONS.has(value)) fields[key] = value;
    }
  }
  return Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join(";");
}

/** The handler owns this copy; an awaited approval never lends it caller-owned mutable input. */
export function createManagedArgumentsSnapshot(input: unknown): unknown {
  return JSON.parse(canonicalInput(input));
}

function invalid(): never {
  throw new Error("managed_arguments_invalid");
}

function canonicalInput(input: unknown): string {
  let nodes = 0;
  let bytes = 0;
  const ancestors = new WeakSet<object>();
  const emit = (text: string) => {
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > MAX_INPUT_BYTES) invalid();
    return text;
  };
  const serialize = (value: unknown, depth: number): string => {
    if (++nodes > MAX_INPUT_NODES || depth > MAX_INPUT_DEPTH) invalid();
    if (value === null) return emit("null");
    if (typeof value === "string") {
      if (value.length > MAX_INPUT_BYTES) invalid();
      return emit(JSON.stringify(value));
    }
    if (typeof value === "boolean") return emit(value ? "true" : "false");
    if (typeof value === "number") {
      if (!Number.isFinite(value)) invalid();
      return emit(Object.is(value, -0) ? "-0" : String(value));
    }
    if (typeof value !== "object" || ancestors.has(value)) invalid();
    if (Object.getOwnPropertySymbols(value).length) invalid();
    ancestors.add(value);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) invalid();
        if (Object.keys(descriptors).length !== value.length + 1) invalid();
        const parts: string[] = [];
        for (let i = 0; i < value.length; i++) {
          const descriptor = descriptors[String(i)];
          if (!descriptor || !Object.hasOwn(descriptor, "value")) invalid();
          parts.push(serialize(descriptor.value, depth + 1));
        }
        emit(",".repeat(Math.max(0, parts.length - 1)));
        return emit("[") + parts.join(",") + emit("]");
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) invalid();
      const parts = Object.keys(descriptors)
        .sort()
        .map((key) => {
          const descriptor = descriptors[key];
          if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) invalid();
          return emit(JSON.stringify(key)) + emit(":") + serialize(descriptor.value, depth + 1);
        });
      emit(",".repeat(Math.max(0, parts.length - 1)));
      return emit("{") + parts.join(",") + emit("}");
    } finally {
      ancestors.delete(value);
    }
  };
  return serialize(input, 0);
}
