import path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import type {
  CustomEntry,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

import { findLink, isSkipped, readSession } from "./history.ts";
import { INTENT_TYPE, isContinuation, isHandoffData } from "./schema.ts";
import type {
  Continuation,
  HandoffData,
  HandoffId,
  UncertainEffect,
} from "./schema.ts";

export const TOOL_NAME = "continue_session";

const ABORTED = /aborted/iu;

const isHandoffId = (value: string): value is HandoffId => value !== "";

export const newHandoffId = (): HandoffId => {
  const id = crypto.randomUUID();

  if (!isHandoffId(id)) {
    throw new Error("crypto.randomUUID returned an empty string");
  }

  return id;
};

export interface Request {
  continuation: Continuation;
  /** The tool result entry that holds the request. */
  entryId: string;
}

/** Every continue_session result in the given entries, oldest first. */
export const requests = (entries: readonly SessionEntry[]): Request[] =>
  entries.flatMap((entry) =>
    entry.type === "message" &&
    entry.message.role === "toolResult" &&
    entry.message.toolName === TOOL_NAME &&
    !entry.message.isError &&
    isContinuation(entry.message.details)
      ? [{ continuation: entry.message.details, entryId: entry.id }]
      : []
  );

/** Whether a user message follows the entry on the branch, such as a delivered follow-up. */
export const hasLaterUserMessage = (
  branch: readonly SessionEntry[],
  entryId: string
): boolean =>
  branch
    .slice(branch.findIndex((entry) => entry.id === entryId) + 1)
    .some((entry) => entry.type === "message" && entry.message.role === "user");

/**
 * Tool calls on the branch whose effects nobody can confirm: calls with no result, and calls whose
 * result reports an abort. Pi records no abort flag, only error text such as "Operation aborted"
 * (pi-agent-core agent-loop.js:444) or "Command aborted" (tools/bash.js:271). Calls in an assistant
 * message that ended in error or abort are left out, because Pi never runs them (agent-loop.js:148).
 */
export const uncertainEffects = (
  branch: readonly SessionEntry[]
): UncertainEffect[] => {
  const results = new Map<string, { isError: boolean; text: string }>();

  for (const entry of branch) {
    if (entry.type === "message" && entry.message.role === "toolResult") {
      results.set(entry.message.toolCallId, {
        isError: entry.message.isError,
        text: entry.message.content
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("\n"),
      });
    }
  }

  const effects: UncertainEffect[] = [];

  for (const entry of branch) {
    if (
      entry.type !== "message" ||
      entry.message.role !== "assistant" ||
      entry.message.stopReason === "aborted" ||
      entry.message.stopReason === "error"
    ) {
      continue;
    }

    for (const block of entry.message.content) {
      if (block.type !== "toolCall") {
        continue;
      }

      const result = results.get(block.id);

      const effect = {
        entryId: entry.id,
        toolCallId: block.id,
        toolName: block.name,
      };

      if (result === undefined) {
        effects.push({ ...effect, reason: "no-result" });
      } else if (result.isError && ABORTED.test(result.text)) {
        effects.push({ ...effect, reason: "aborted" });
      }
    }
  }

  return effects;
};

/** The intent for a request, with the source as it stands now. Read before appending the intent. */
export const buildIntent = (
  sessionManager: ExtensionContext["sessionManager"],
  continuation: Continuation
): HandoffData | undefined => {
  const file = sessionManager.getSessionFile();
  const leafId = sessionManager.getLeafId();

  if (file === undefined || leafId === null) {
    return undefined;
  }

  return {
    constraints: continuation.constraints,
    handoffId: continuation.handoffId,
    source: { file, leafId, sessionId: sessionManager.getSessionId() },
    task: continuation.task,
    uncertainEffects: uncertainEffects(sessionManager.getBranch()),
  };
};

export const marker = (handoffId: string): string =>
  `[pi-continue ${handoffId}]`;

/** The first message of a destination session. It must never start with "/". */
export const continuationText = (data: HandoffData): string => {
  const lines = [
    marker(data.handoffId),
    "Task:",
    data.task,
    "Active constraints (verbatim):",
    ...data.constraints.map((constraint) => `- ${constraint}`),
  ];

  if (data.uncertainEffects.length > 0) {
    lines.push(
      "Possible effects of interrupted tool calls (check before repeating):",
      ...data.uncertainEffects.map(
        (effect) =>
          `- ${effect.toolName} call ${effect.toolCallId} at entry ${effect.entryId}: ${effect.reason}`
      )
    );
  }

  lines.push(
    `Source: ${data.source.file}`,
    `Source session ID: ${data.source.sessionId}`,
    `Source leaf ID: ${data.source.leafId}`,
    "Prior history is not in this context. Use the continue_history tool to read it."
  );

  return lines.join("\n");
};

type IntentEntry = CustomEntry<HandoffData> & { data: HandoffData };

const isIntentEntry = (entry: SessionEntry): entry is IntentEntry =>
  entry.type === "custom" &&
  entry.customType === INTENT_TYPE &&
  isHandoffData(entry.data);

/** Every intent in the given entries, oldest first. */
export const intents = (entries: readonly SessionEntry[]): HandoffData[] =>
  entries.flatMap((entry) => (isIntentEntry(entry) ? [entry.data] : []));

/** The intent for handoffId anywhere in the session, or the latest intent on the current branch. */
export const findIntent = (
  allEntries: readonly SessionEntry[],
  branch: readonly SessionEntry[],
  handoffId: string | undefined
): HandoffData | undefined =>
  handoffId === undefined
    ? intents(branch).at(-1)
    : intents(allEntries).findLast((intent) => intent.handoffId === handoffId);

export interface Destination {
  file: string;
  /** True when the last message is the continuation, still without a reply. */
  unanswered: boolean;
}

/**
 * Finds a session that already holds the link for this handoff. It reads candidate files and
 * never opens them. Two pi processes searching at the same moment can still both find nothing.
 */
export const findDestination = async (
  intent: HandoffData
): Promise<Destination | undefined> => {
  // listAll, unlike list, does not drop sessions whose cwd differs from the caller's.
  const candidates = await SessionManager.listAll(
    path.dirname(intent.source.file)
  );

  const sessions = await Promise.all(
    candidates
      .filter((info) => info.parentSessionPath === intent.source.file)
      .map(async (info) => await readSession(info.path))
  );

  for (const session of sessions) {
    if (
      !isSkipped(session) &&
      findLink(session.entries)?.handoffId === intent.handoffId
    ) {
      const lastMessage = session.entries.findLast(
        (entry) => entry.type === "message"
      );

      return {
        file: session.file,
        unanswered:
          lastMessage?.type === "message" &&
          lastMessage.message.role === "user",
      };
    }
  }

  return undefined;
};
