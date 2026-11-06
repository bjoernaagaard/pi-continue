import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import {
  continuationText,
  findDestination,
  findIntent,
  intents,
} from "./handoff.ts";
import {
  DEFAULT_AROUND,
  DEFAULT_MAX_HITS,
  findLink,
  search,
  walkChain,
} from "./history.ts";
import { HistoryParams, historyParams, LINK_TYPE } from "./schema.ts";
import type { HandoffData } from "./schema.ts";

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

const continueCommand = async (
  args: string,
  ctx: ExtensionCommandContext,
  command: string
): Promise<void> => {
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

  const { sessionManager } = ctx;

  const intent = findIntent(
    sessionManager.getEntries(),
    sessionManager.getBranch(),
    requested
  );

  if (intent === undefined) {
    ctx.ui.notify(
      requested === undefined
        ? "pi-continue: no handoff intent on this branch."
        : `pi-continue: no handoff intent with ID ${requested} in this session.`,
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
      await continueCommand(args, ctx, commandName(pi));
    },
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

    const pending = await Promise.all(
      intents(entries).map(async (intent) =>
        (await findDestination(intent)) === undefined ? [intent.handoffId] : []
      )
    );

    const command = commandName(pi);

    for (const handoffId of pending.flat()) {
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
