import {
  arr,
  bool,
  compile,
  int,
  obj,
  oneOf,
  opt,
  str,
} from "@earendil-works/pi-schema";
import type { Static } from "@earendil-works/pi-schema";

export const INTENT_TYPE = "pi-continue/intent";
export const LINK_TYPE = "pi-continue/link";

export type HandoffId = string & { readonly brand: "HandoffId" };

const SourceRefSchema = obj({
  file: str({ minLength: 1 }),
  leafId: str({ minLength: 1 }),
  sessionId: str({ minLength: 1 }),
});

const UncertainEffectSchema = obj({
  entryId: str(),
  reason: oneOf(["no-result", "aborted"]),
  toolCallId: str(),
  toolName: str(),
});

const HandoffDataSchema = obj({
  constraints: arr(str()),
  handoffId: str({ minLength: 1 }),
  source: SourceRefSchema,
  task: str({ minLength: 1 }),
  uncertainEffects: arr(UncertainEffectSchema),
});

export type SourceRef = Static<typeof SourceRefSchema>;

export type UncertainEffect = Static<typeof UncertainEffectSchema>;

/** Intent entries (in the source) and link entries (in the destination) carry the same data. */
export type HandoffData = Static<typeof HandoffDataSchema> & {
  handoffId: HandoffId;
};

const handoffData = compile(HandoffDataSchema);

export const isHandoffData = (value: unknown): value is HandoffData =>
  handoffData.check(value);

export const ContinueSessionParams = obj({
  constraints: arr(str(), {
    description:
      "Every active constraint, copied verbatim from the conversation. They are never rewritten.",
  }),
  task: str({
    description: "The task the new session must carry on with.",
    minLength: 1,
  }),
});

export const HistoryParams = obj({
  around: opt(
    int({
      description:
        "Neighbouring entries to include on each side of a hit. Default 2.",
      minimum: 0,
    })
  ),
  entryId: opt(
    str({
      description: "Return this entry and its neighbours instead of searching.",
    })
  ),
  maxHits: opt(
    int({ description: "Maximum matching entries. Default 20.", minimum: 1 })
  ),
  query: opt(
    str({
      description:
        "Case-insensitive search. Every word must appear in the entry.",
    })
  ),
  session: opt(
    str({ description: "Restrict to one source, by session ID or file path." })
  ),
  wholeFile: opt(
    bool({
      description:
        "Search every branch of each source file, not only the branch that was handed off.",
    })
  ),
});

export const continueSessionParams = compile(ContinueSessionParams);
export const historyParams = compile(HistoryParams);
