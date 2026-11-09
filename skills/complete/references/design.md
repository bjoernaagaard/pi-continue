# Design

Settle what should change, then order the work. Read the request and the research in full, and verify against live code any fact a choice depends on. Fold new facts into the research document.

## Design document

Write `02-design.md` with the desired end state first, in terms of what a user or caller can observe. Then record the settled choices, each with the options weighed and why the alternatives lost. Name the existing patterns to follow, with paths. Check the deliverables from the request against the design, and reword any deliverable the design changes. Confirm the merge basis still holds once the scope is concrete, and say so in the document.

Put unsettled choices under open questions. In attended mode, ask them one at a time and move each answer into the settled choices. In send mode, settle a choice yourself unless it needs the user under the stop conditions, and record the default taken.

## Outline document

Write `03-outline.md` as ordered phases that each end in a testable result. Keep phases small and end to end, so each one works with the work before it. For each phase write the result it delivers, the files and shapes it changes, and its validation, split into commands that run on their own and checks that need human judgment. Use the repository's real commands. Open the document with one unchecked overview item per phase, and give each validation item its own checkbox.
