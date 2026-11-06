import { readFile } from "node:fs/promises";

import {
  CURRENT_SESSION_VERSION,
  parseSessionEntries,
} from "@earendil-works/pi-coding-agent";
import type {
  CustomEntry,
  FileEntry,
  SessionEntry,
  SessionHeader,
} from "@earendil-works/pi-coding-agent";

import { isHandoffData, LINK_TYPE } from "./schema.ts";
import type { HandoffData } from "./schema.ts";

export const EXCERPT_CHARS = 600;
export const RESULT_CHARS = 12_000;
export const CHAIN_DEPTH = 32;
export const DEFAULT_AROUND = 2;
export const DEFAULT_MAX_HITS = 20;

const LINE_BREAK = /\r?\n/u;
const WORD_SPLIT = /\s+/u;

export interface ParsedSession {
  file: string;
  header: SessionHeader;
  entries: SessionEntry[];
  malformedLines: number;
}

export interface Skipped {
  file: string;
  reason:
    | "missing"
    | "unreadable"
    | "no-header"
    | "unsupported-version"
    | "repeated"
    | "depth-limit"
    | "malformed-lines";
  detail?: string;
}

export interface ChainSource {
  session: ParsedSession;
  /** The source leaf recorded by the link that led here. */
  leafId: string;
}

export interface EntryText {
  role?: string;
  text: string;
}

export interface Excerpt {
  file: string;
  sessionId: string;
  entryId: string;
  parentId: string | null;
  type: string;
  role?: string;
  timestamp: string;
  text: string;
  truncated: boolean;
  hit: boolean;
}

const isHeader = (entry: FileEntry): entry is SessionHeader =>
  entry.type === "session";

/** Reads a session file without opening, migrating or writing it. */
export const readSession = async (
  file: string
): Promise<ParsedSession | Skipped> => {
  let content = "";

  try {
    content = await readFile(file, "utf-8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { file, reason: "missing" };
    }

    return { detail: String(error), file, reason: "unreadable" };
  }

  const parsed = parseSessionEntries(content);
  const [first, ...rest] = parsed;

  if (first === undefined || !isHeader(first)) {
    return { file, reason: "no-header" };
  }

  if (first.version !== CURRENT_SESSION_VERSION) {
    return {
      detail: `version ${first.version ?? 1}`,
      file,
      reason: "unsupported-version",
    };
  }

  const nonEmptyLines = content
    .split(LINE_BREAK)
    .filter((line) => line.trim() !== "").length;

  const entries = rest.filter(
    (entry): entry is SessionEntry => !isHeader(entry)
  );

  return {
    entries,
    file,
    header: first,
    malformedLines: nonEmptyLines - parsed.length,
  };
};

export const isSkipped = (value: ParsedSession | Skipped): value is Skipped =>
  "reason" in value;

/** The latest valid link entry in a session, if any. */
export const findLink = (
  entries: readonly SessionEntry[]
): HandoffData | undefined =>
  entries.findLast(
    (entry): entry is CustomEntry<HandoffData> =>
      entry.type === "custom" &&
      entry.customType === LINK_TYPE &&
      isHandoffData(entry.data)
  )?.data;

/**
 * Follows link entries from the current session back through its sources. Stops at a missing or
 * unsupported file, a file without a link, a repeated file, or the depth limit.
 */
export const walkChain = async (
  currentFile: string | undefined,
  start: HandoffData
): Promise<{ sources: ChainSource[]; skipped: Skipped[] }> => {
  const sources: ChainSource[] = [];
  const skipped: Skipped[] = [];
  const seen = new Set<string>(currentFile === undefined ? [] : [currentFile]);
  let link: HandoffData | undefined = start;

  while (link !== undefined) {
    const { file, leafId } = link.source;

    if (seen.has(file)) {
      skipped.push({ file, reason: "repeated" });
      break;
    }

    if (sources.length >= CHAIN_DEPTH) {
      skipped.push({
        detail: `limit ${CHAIN_DEPTH}`,
        file,
        reason: "depth-limit",
      });
      break;
    }

    seen.add(file);
    // Each link names the next file, so the reads cannot run in parallel.
    // oxlint-disable-next-line no-await-in-loop
    const session = await readSession(file);

    if (isSkipped(session)) {
      skipped.push(session);
      break;
    }

    if (session.malformedLines > 0) {
      skipped.push({
        detail: `${session.malformedLines} lines`,
        file,
        reason: "malformed-lines",
      });
    }

    sources.push({ leafId, session });
    link = findLink(session.entries);
  }

  return { skipped, sources };
};

/** Entries on the branch that ends at leafId, root first. */
export const branchTo = (
  entries: readonly SessionEntry[],
  leafId: string
): SessionEntry[] => {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const branch: SessionEntry[] = [];
  let current = byId.get(leafId);

  while (current !== undefined && branch.length <= entries.length) {
    branch.push(current);
    current =
      current.parentId === null ? undefined : byId.get(current.parentId);
  }

  return branch.toReversed();
};

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  arguments?: unknown;
}

const isBlockList = (
  content: string | readonly ContentBlock[]
): content is readonly ContentBlock[] => Array.isArray(content);

const blocksText = (content: string | readonly ContentBlock[]): string => {
  if (!isBlockList(content)) {
    return content;
  }

  const parts: string[] = [];

  for (const block of content) {
    if (block.type === "text" && block.text !== undefined) {
      parts.push(block.text);
    } else if (block.type === "toolCall") {
      parts.push(
        `[tool call ${block.name ?? ""}] ${JSON.stringify(block.arguments)}`
      );
    }
  }

  return parts.join("\n");
};

const messageText = (entry: SessionEntry & { type: "message" }): EntryText => {
  const { message } = entry;

  switch (message.role) {
    case "user":
    case "assistant":
    case "custom": {
      return { role: message.role, text: blocksText(message.content) };
    }

    case "toolResult": {
      return {
        role: message.role,
        text: `[${message.toolName} result] ${blocksText(message.content)}`,
      };
    }

    case "bashExecution": {
      return {
        role: message.role,
        text: `$ ${message.command}\n${message.output}`,
      };
    }

    case "branchSummary":
    case "compactionSummary": {
      return { role: message.role, text: message.summary };
    }

    case "system": {
      return { role: message.role, text: "" };
    }

    default: {
      return { text: "" };
    }
  }
};

/** Searchable text of an entry. Entries with no conversational content give "". */
export const entryText = (entry: SessionEntry): EntryText => {
  switch (entry.type) {
    case "message": {
      return messageText(entry);
    }

    case "custom_message": {
      return { text: blocksText(entry.content) };
    }

    case "compaction":
    case "branch_summary": {
      return { text: entry.summary };
    }

    case "custom": {
      return { text: `[${entry.customType}] ${JSON.stringify(entry.data)}` };
    }

    case "context_edit":
    case "label":
    case "model_change":
    case "session_info":
    case "thinking_level_change":
    case "usage": {
      return { text: "" };
    }

    default: {
      return { text: "" };
    }
  }
};

export const toExcerpt = (
  session: ParsedSession,
  entry: SessionEntry,
  hit: boolean
): Excerpt => {
  const { role, text } = entryText(entry);
  const truncated = text.length > EXCERPT_CHARS;

  return {
    entryId: entry.id,
    file: session.file,
    hit,
    parentId: entry.parentId,
    role,
    sessionId: session.header.id,
    text: truncated ? `${text.slice(0, EXCERPT_CHARS)}…` : text,
    timestamp: entry.timestamp,
    truncated,
    type: entry.type,
  };
};

export interface SearchOptions {
  query?: string;
  entryId?: string;
  around: number;
  maxHits: number;
  wholeFile: boolean;
}

export interface SearchResult {
  excerpts: Excerpt[];
  hits: number;
  /** True when maxHits or the result size limit cut the result short. */
  truncated: boolean;
}

type HitTest = (entry: SessionEntry, text: string) => boolean;

const never: HitTest = () => false;

const hitTest = ({ entryId, query }: SearchOptions): HitTest => {
  if (entryId !== undefined) {
    return (entry) => entry.id === entryId;
  }

  if (query === undefined) {
    return never;
  }

  const words = query.toLowerCase().split(WORD_SPLIT).filter(Boolean);

  return (_entry, text) => {
    const lower = text.toLowerCase();

    return text !== "" && words.every((word) => lower.includes(word));
  };
};

/**
 * Searches sources nearest first. A hit adds itself and `around` neighbours on each side, in the
 * order of the searched entries. Stops at maxHits hits or once the excerpts exceed RESULT_CHARS.
 */
export const search = (
  sources: readonly ChainSource[],
  options: SearchOptions
): SearchResult => {
  const isHit = hitTest(options);
  const excerpts: Excerpt[] = [];
  let hits = 0;
  let chars = 0;

  for (const { leafId, session } of sources) {
    const scope = options.wholeFile
      ? session.entries
      : branchTo(session.entries, leafId);

    const included = new Map<number, Excerpt>();

    for (const [index, entry] of scope.entries()) {
      if (!isHit(entry, entryText(entry).text)) {
        continue;
      }

      if (hits >= options.maxHits) {
        return { excerpts, hits, truncated: true };
      }

      hits += 1;
      const from = Math.max(0, index - options.around);
      const to = Math.min(scope.length - 1, index + options.around);

      for (let near = from; near <= to; near += 1) {
        const existing = included.get(near);
        const nearEntry = scope[near];

        if (existing !== undefined) {
          existing.hit ||= near === index;
        } else if (nearEntry !== undefined) {
          const excerpt = toExcerpt(session, nearEntry, near === index);
          chars += excerpt.text.length;

          if (chars > RESULT_CHARS) {
            return { excerpts, hits, truncated: true };
          }

          included.set(near, excerpt);
          excerpts.push(excerpt);
        }
      }
    }
  }

  return { excerpts, hits, truncated: false };
};
