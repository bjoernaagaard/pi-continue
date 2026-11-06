import type {
  CustomEntry,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

import { INTENT_TYPE, isHandoffData } from "./schema.ts";
import type { HandoffData } from "./schema.ts";

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
