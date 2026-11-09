# Implement

Build one outline phase per session. Without an outline, build the whole change in one session from the request and design.

## Start

Read every workflow document in full, then the source files the phase touches. Run `git status --short` and account for changes already present. When on the default branch in send mode, create a branch before editing.

## Loop

Follow the phase change outline and the patterns the design names. Keep the change to the smallest shape that delivers the phase result.

Run every automated validation command the outline lists. Fix failures before ticking any box. Record proof in the outline as the command, its result, and where the output lives when it outlives the session. Proof means evidence from a real run, so prefer running the app or command the change affects over reading the code again. Tick a validation box only after its check passes, and tick the overview item and mark the phase heading with a check only when every validation item passes or the user confirms the manual ones.

When live code contradicts the outline in a way that changes the result, stop and write the mismatch into the outline, then follow the stop conditions. Write what the outline expected, what the code holds, and why the difference matters.

## Finish

Hand off to the next incomplete outline phase, or to review when every phase is checked. In attended mode, stop and report the phase result, its proof, and any manual check still waiting on the user.
