# Review

Review the diff as if another engineer wrote it. This session must not read the implementing session through `continue_history`. The diff, the request, the design, and the outline are enough.

## Scope

Find the base with `git merge-base HEAD origin/<default-branch>` after a fetch, or use the base the handoff names. The change is that base to the working tree, untracked files included. Run the checks the outline lists before judging the diff, and record their results.

## Ledger

Write `04-review.md` with the base, the intent in one or two sentences, what sits out of scope, the check results, and one finding per problem with a stable id.

```text
S1 [blocker] src/file.ts:42 <claim>. Fix: <smallest change>.
```

A blocker makes an intended case wrong. A should is a real bug callers will hit inside the intent. Everything else is a nit. Look for broken callers and code the intent does not need. Skip style unless it hides a bug.

## Rounds

With no blocker or should open, write the verdict approved and hand off to ship. Otherwise hand off to an implement session whose task names this ledger and nothing else to fix. That session marks each finding fixed, disagreed with evidence, or declined with a reason, reruns the checks, and hands back here.

Later rounds cover only the open ids and the code changed since the last round. Allow three rounds, or five for security, data loss, or concurrency while a blocker or should stays open with evidence. A finding still disputed after two replies goes to the user with both sides in the ledger.
