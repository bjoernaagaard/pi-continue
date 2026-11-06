import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
  buildIntent,
  continuationText,
  findDestination,
  findIntent,
  hasLaterUserMessage,
  intents,
  newHandoffId,
  requests,
  TOOL_NAME,
  withContinuation,
} from "./handoff.ts";
import {
  DEFAULT_AROUND,
  DEFAULT_MAX_HITS,
  findLink,
  search,
  walkChain,
} from "./history.ts";
import {
  ContinueSessionParams,
  continueSessionParams,
  HistoryParams,
  historyParams,
  INTENT_TYPE,
  LINK_TYPE,
} from "./schema.ts";
import type { Continuation, HandoffData } from "./schema.ts";

const COMMAND = "continue";
const SELF = import.meta.filename;

/**
 * The name Pi gave this extension's command. Pi renames every command whose name another
 * extension also registers to `name:<n>` (extensions/runner.js:570), so "/continue" alone may
 * reach nothing.
 */
const commandName = (pi: ExtensionAPI): string =>
  pi
    .getCommands()
    .find(
      (command) =>
        command.sourceInfo.path === SELF &&
        (command.name === COMMAND || command.name.startsWith(`${COMMAND}:`))
    )?.name ?? COMMAND;

const textResult = <T>(text: string, details: T) => ({
  content: [{ text, type: "text" as const }],
  details,
});

const dispatch = async (
  ctx: ExtensionCommandContext,
  intent: HandoffData,
  command: string
): Promise<void> => {
  const { handoffId } = intent;
  const text = continuationText(intent);

  // Pi creates the file only once it holds a user message (session-manager.js:786-813), so the
  // link should reach disk with the first message that withSession sends.
  const result = await ctx.newSession({
    parentSession: intent.source.file,
    // Pi types setup as returning a promise, and appendCustomEntry is synchronous.
    // oxlint-disable-next-line require-await
    setup: async (sessionManager) => {
      sessionManager.appendCustomEntry(LINK_TYPE, intent);
    },
    withSession: async (next) => {
      await next.sendUserMessage(text);
    },
  });

  if (result.cancelled) {
    ctx.ui.notify(
      `Handoff ${handoffId}: another extension cancelled the new session. Run /${command} ${handoffId} to retry.`,
      "warning"
    );
  }
};

/** Writes the intent for a request to the source. The source ref is read before the append. */
const recordIntent = (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  continuation: Continuation
): HandoffData | undefined => {
  const intent = buildIntent(ctx.sessionManager, continuation);

  if (intent !== undefined) {
    pi.appendEntry(INTENT_TYPE, intent);
  }

  return intent;
};

/** The intent for the handoff, written now from its continue_session request if it has none. */
const intentFor = (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  handoffId: string | undefined
): HandoffData | undefined => {
  const { sessionManager } = ctx;
  const entries = sessionManager.getEntries();
  const branch = sessionManager.getBranch();
  const existing = findIntent(entries, branch, handoffId);

  if (existing !== undefined) {
    return existing;
  }

  const written = new Set(intents(entries).map((intent) => intent.handoffId));

  const request = (
    handoffId === undefined ? requests(branch) : requests(entries)
  )
    .filter(({ continuation }) => !written.has(continuation.handoffId))
    .findLast(
      ({ continuation }) =>
        handoffId === undefined || continuation.handoffId === handoffId
    );

  return request === undefined
    ? undefined
    : recordIntent(pi, ctx, request.continuation);
};

const continueCommand = async (
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI
): Promise<void> => {
  const command = commandName(pi);
  const requested = args.trim() === "" ? undefined : args.trim();

  const retry =
    requested === undefined
      ? `Run /${command} when ready.`
      : `Run /${command} ${requested} when ready.`;

  if (!ctx.isIdle() || ctx.hasPendingMessages()) {
    ctx.ui.notify(
      `pi-continue: refused while a run is active or messages are queued. ${retry}`,
      "warning"
    );

    return;
  }

  const intent = intentFor(pi, ctx, requested);

  if (intent === undefined) {
    ctx.ui.notify(
      requested === undefined
        ? "pi-continue: no handoff on this branch."
        : `pi-continue: no handoff with ID ${requested} in this session.`,
      "error"
    );

    return;
  }

  const existing = await findDestination(intent);

  if (existing === undefined) {
    await dispatch(ctx, intent, command);

    return;
  }

  const notice = existing.unanswered
    ? `pi-continue: switched to the existing session for handoff ${intent.handoffId}. Its continuation has no reply yet. Send a message to start. Nothing was resent.`
    : `pi-continue: switched to the existing session for handoff ${intent.handoffId}. Nothing was resent.`;

  const result = await ctx.switchSession(existing.file, {
    // oxlint-disable-next-line require-await
    withSession: async (next) => {
      next.ui.notify(notice, "info");
    },
  });

  if (result.cancelled) {
    ctx.ui.notify(
      `pi-continue: another extension cancelled the switch to ${existing.file}.`,
      "warning"
    );
  }
};

export default function piContinue(pi: ExtensionAPI): void {
  pi.registerCommand(COMMAND, {
    description:
      "Continue in a fresh session that holds only the task, the constraints and a link to this one: /continue [handoffId]",
    handler: async (args, ctx) => {
      await continueCommand(args, ctx, pi);
    },
  });

  // Requests made during the current run. Only these dispatch when the run settles, so a request
  // refused earlier waits for /continue instead of firing after some later run.
  const requestedThisRun = new Set<string>();

  pi.registerTool({
    description:
      "Hand off to a fresh session. It starts with only the task, the active constraints copied verbatim, and a link to this session; it reads earlier history on demand with continue_history. The handoff happens after this run ends, so end your turn right after calling this tool.",
    // oxlint-disable-next-line require-await
    async execute(_toolCallId, params) {
      if (!continueSessionParams.check(params)) {
        throw new Error(
          continueSessionParams
            .errors(params)
            .map((error) => `${error.path} ${error.message}`)
            .join("; ")
        );
      }

      const handoffId = newHandoffId();

      const details: Continuation = {
        constraints: params.constraints,
        handoffId,
        task: params.task,
      };

      requestedThisRun.add(handoffId);

      return textResult(
        `Handoff ${handoffId} requested. pi-continue opens the new session once this run ends. End your turn now.`,
        details
      );
    },
    label: "Continue session",
    name: TOOL_NAME,
    parameters: ContinueSessionParams,
    promptSnippet:
      "continue_session: hand off to a fresh session with the task and verbatim constraints",
  });

  pi.on("agent_settled", (event, ctx) => {
    const thisRun = new Set(requestedThisRun);

    requestedThisRun.clear();

    const { sessionManager } = ctx;
    const branch = sessionManager.getBranch();

    const written = new Set(
      intents(sessionManager.getEntries()).map((intent) => intent.handoffId)
    );

    const request = requests(branch).findLast(
      ({ continuation }) =>
        thisRun.has(continuation.handoffId) &&
        !written.has(continuation.handoffId)
    );

    if (request === undefined) {
      return;
    }

    const { handoffId } = request.continuation;
    const command = commandName(pi);

    const reasons = [
      event.aborted ? "the run was aborted" : "",
      ctx.hasPendingMessages() ? "messages are queued" : "",
      hasLaterUserMessage(branch, request.entryId)
        ? "a user message arrived after the request"
        : "",
    ].filter((reason) => reason !== "");

    if (reasons.length > 0) {
      ctx.ui.notify(
        `pi-continue: handoff ${handoffId} refused because ${reasons.join(" and ")}. Run /${command} ${handoffId} when ready.`,
        "warning"
      );

      return;
    }

    if (recordIntent(pi, ctx, request.continuation) === undefined) {
      ctx.ui.notify(
        `pi-continue: handoff ${handoffId} needs a saved session with at least one entry.`,
        "error"
      );

      return;
    }

    // Pi defers this prompt until every agent_settled handler has finished (agent-session.js:1650).
    pi.sendUserMessage(`/${command} ${handoffId}`, {
      expandPromptTemplates: true,
    });
  });

  // Re-inserts the continuation for this model call only when compaction has dropped it. The
  // session file is not changed.
  pi.on("context", (event, ctx) => {
    const link = findLink(ctx.sessionManager.getEntries());

    const messages =
      link === undefined ? undefined : withContinuation(event.messages, link);

    return messages === undefined ? undefined : { messages };
  });

  pi.on("session_start", async (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const link = findLink(entries);

    if (link !== undefined) {
      ctx.ui.notify(
        `pi-continue: handoff ${link.handoffId} continues ${link.source.file}`,
        "info"
      );
    }

    const intended = intents(entries);
    const written = new Set(intended.map((intent) => intent.handoffId));

    const requestedOnly = requests(entries)
      .map(({ continuation }) => continuation.handoffId)
      .filter((handoffId) => !written.has(handoffId));

    const undispatched = await Promise.all(
      intended.map(async (intent) =>
        (await findDestination(intent)) === undefined ? [intent.handoffId] : []
      )
    );

    const command = commandName(pi);

    for (const handoffId of new Set([
      ...requestedOnly,
      ...undispatched.flat(),
    ])) {
      ctx.ui.notify(
        `pi-continue: handoff ${handoffId} has no destination session yet. Run /${command} ${handoffId} to create it.`,
        "warning"
      );
    }
  });

  pi.registerTool({
    description:
      "Read history from the sessions this session continues. Follows pi-continue links back through earlier sessions, read-only, and stops at a missing, repeated or unsupported file or after 32 sessions. Searches only the handed-off branch of each source unless wholeFile is true. Without query or entryId it lists the linked sources. Results quote entries with their original file and entry ID.",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!historyParams.check(params)) {
        throw new Error(
          historyParams
            .errors(params)
            .map((error) => `${error.path} ${error.message}`)
            .join("; ")
        );
      }

      const link = findLink(ctx.sessionManager.getEntries());

      if (link === undefined) {
        throw new Error(
          "This session has no pi-continue link, so it has no source history."
        );
      }

      const { skipped, sources } = await walkChain(
        ctx.sessionManager.getSessionFile(),
        link
      );

      const chain = sources.map(({ leafId, session }) => ({
        entries: session.entries.length,
        file: session.file,
        leafId,
        sessionId: session.header.id,
      }));

      const searched =
        params.session === undefined
          ? sources
          : sources.filter(
              ({ session }) =>
                session.header.id === params.session ||
                session.file === params.session
            );

      const wantsExcerpts =
        params.query !== undefined || params.entryId !== undefined;

      const found = wantsExcerpts
        ? search(searched, {
            around: params.around ?? DEFAULT_AROUND,
            entryId: params.entryId,
            maxHits: params.maxHits ?? DEFAULT_MAX_HITS,
            query: params.query,
            wholeFile: params.wholeFile ?? false,
          })
        : { excerpts: [], hits: 0, truncated: false };

      const result = { chain, skipped, ...found };

      return textResult(JSON.stringify(result), result);
    },
    label: "Continue history",
    name: "continue_history",
    parameters: HistoryParams,
    promptSnippet:
      "continue_history: search the sessions this session continues",
  });
}
