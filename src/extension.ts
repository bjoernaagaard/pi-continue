import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  DEFAULT_AROUND,
  DEFAULT_MAX_HITS,
  findLink,
  search,
  walkChain,
} from "./history.ts";
import { HistoryParams, historyParams } from "./schema.ts";

const textResult = <T>(text: string, details: T) => ({
  content: [{ text, type: "text" as const }],
  details,
});

export default function piContinue(pi: ExtensionAPI): void {
  pi.registerTool({
    description:
      "Read history from the sessions this session continues. Follows pi-continue links back through every earlier session, read-only. Without query or entryId it lists the linked sources. Results quote entries with their original file and entry ID.",
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
