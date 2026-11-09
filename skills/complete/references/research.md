# Research

Answer how the current system works. Make no design choices and no recommendations.

## Passes

Run these passes in order in this session. Write findings into the document as each pass lands, so a later handoff can resume mid phase.

1. **Locate.** Find the files, configuration, and checks that touch the task. Group them by purpose.
2. **Trace.** Read the relevant files in full. Follow calls and data from entry to exit. Record file and line references for every claim.
3. **Patterns.** Find how the codebase already solves nearby problems, and name the test or check pattern each area uses.
4. **External.** When a dependency decides a fact, read its documentation or type definitions and link the source.

## Document

Write `01-research.md` with the research questions first, taken from the request. Give each finding a heading that states what is true, then the evidence under it. Cover behavior, data flow, constraints, edge cases, and the checks that exist, and state plainly where no check exists. Distinguish checks read from checks run, and give the command and result for any check run. End with open questions, or write that none remain.

Keep the desired change out of the findings. The request document already holds it, and keeping research descriptive stops the design phase from inheriting a conclusion dressed as a fact.
