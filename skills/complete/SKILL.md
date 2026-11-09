---
name: complete
description: Run one task from research to a merged pull request with a single agent and a single model. Each phase runs in a fresh pi-continue session and reads only the documents the earlier phases wrote. Use only when the user invokes /skill:complete.
compatibility: Requires the pi-continue extension tools continue_session and continue_history.
disable-model-invocation: true
metadata:
  version: 0.1.0
---

# Complete

One agent and one model do the whole task. Do not spawn subagents or delegate any part of it. Each phase runs in a fresh session so no phase inherits the reasoning, dead ends, or bulk output of the phase before it. Documents in the task directory carry the facts between sessions.

## Modes

- **Attended** is the default. End each phase by reporting its document and stopping. Hand off only when the user says to continue.
- **Send** applies only when the user asks for the task end to end or unattended. Hand off at every phase boundary and stop only at the stop conditions below.

Record the mode in the request document and copy the mode line into every handoff as a constraint.

## Merging without asking

Send mode may merge without asking only when one of these holds, and the request document quotes the words that establish it.

1. A clear agreement from a previous discussion covers merging work of this kind.
2. The user gave explicit approval to merge this task.
3. The task is clearly scoped, with clear deliverables for completion, and the design document settles those deliverables.

When none holds, stop at a ready pull request and ask. The merge gate in the ship phase must also pass.

## Task directory

Use the directory the user names. Otherwise reuse a matching directory under `.agents/artifacts/`, else create `.agents/artifacts/<branch-or-task-slug>`. State the path and write these documents in order. Do not commit the documents unless the user asks.

| Document | Written by | Holds |
| --- | --- | --- |
| `00-request.md` | intake | Goal in the user's words, mode, merge basis, deliverables, constraints, source pointers, repository and commit |
| `01-research.md` | research | How the current system works, with file and line evidence |
| `02-design.md` | design | Desired end state, settled choices, patterns to follow |
| `03-outline.md` | design | Ordered testable phases with validation commands and checkboxes |
| `04-review.md` | review | Findings ledger with one outcome per finding |
| `05-ship.md` | ship | Pull request, proof, merge result, decisions made for the user |

Scale the chain to the task. A small change with known files needs only the request, then a fresh implement session, then review and ship. Use research, design, and outline when the current behavior is unknown, the change crosses boundaries, or the user needs a review point before code.

## Phases

Read the reference for the current phase, then the documents it names, in full.

| Phase | Reference | Reads | Writes |
| --- | --- | --- | --- |
| research | [references/research.md](references/research.md) | request | research |
| design | [references/design.md](references/design.md) | request, research | design, outline |
| implement | [references/implement.md](references/implement.md) | all documents so far | code, outline checkboxes |
| review | [references/review.md](references/review.md) | request, design, outline, the diff | review |
| ship | [references/ship.md](references/ship.md) | all documents | ship |

Document precedence is outline over design over research over request. The user's latest words override every document, and the session that hears them updates the document that owns the choice.

## Intake

Write `00-request.md` before anything else. Quote the user's goal and constraints word for word. Write the deliverables as testable results. Record the merge basis as a quote, or write that none exists. When the goal is ambiguous in a way that changes the result, ask one question and wait. Then hand off to research, or to implement when the small-change scale applies.

## Handoff

Hand off only after the phase document is saved. Every decision made in conversation must be in a document first, because the next session starts with no transcript and no summary.

Call `continue_session` with a task in this shape and end the turn at once.

```text
Complete phase: <phase> for <goal in one line>.
Read <absolute path of this SKILL.md> and references/<phase>.md first.
Read in full: <absolute paths of the input documents>.
Write: <absolute path of the output document, or the outline phase to implement>.
Done when: <testable condition>.
Then: <hand off to the next phase | stop and report>.
```

Copy constraints verbatim. Include every active user constraint, the mode line, the merge basis line, and this line with the real path filled in.

```text
The documents in <absolute task directory> are the source of truth. Use continue_history only for an exact quote or a gap no document covers.
```

A new session starts by reading this skill, its phase reference, and the named documents in full, then running `git status --short`. When the continuation lists interrupted tool calls, check their effects before repeating any of them.

When a phase outgrows one session, write progress into its document, including the exact next step, then hand off to the same phase to resume. Outline checkboxes and the review ledger are the resume state.

## Resume

When the user invokes Complete on a task directory that already has documents, read them and resume the first incomplete phase. With an outline, resume the first phase whose heading carries no check. Do not rewrite a settled document unless the user asks.

## Stop conditions

Ask the user, with the harness question tool when one exists, and wait when any of these holds.

- The next step deletes data, touches production, sends a message to another person, or closes a pull request.
- A value only the user can pick decides the result, such as a price, a limit customers feel, or words customers read.
- The change cannot be proved with a real run or command.
- The merge gate cannot pass and the blocker sits outside the task.
- Live code contradicts a settled document in a way that changes the result.

Decide everything else in send mode and list each decision in the ship document.
