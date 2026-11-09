# Ship

Open the pull request, watch it, and merge when the gate passes. Do not hand off while the pull request is pending, because the watcher belongs to this session. When this session outgrows its context first, write the pull request number and state into `05-ship.md`, hand off to ship again, and restart the watcher there.

## Pull request

Rebase onto the latest default branch first. Check for an existing pull request on the branch before opening one. Open a real pull request so review bots run. Title it the way recent merged pull requests in the repository are titled. Open the description with the problem in plain words, then the solution, then one line naming how the change was proved. End with the model and harness that made the change. Check the title and description for secrets before submitting.

## Watch

Use the harness pull request watcher when one exists, one watcher per pull request, and end the turn while it runs. Otherwise wait with the repository's own means as one long command. Never write a polling loop. Act only on checks and comments newer than the latest push. Verify each bot finding against the source before changing code, fix real findings with proof before pushing, and answer a dismissed finding with a written reason. Keep the diff at the size the goal needs, and decline growth the intent does not need.

## Merge gate

Merge only when every line holds on the latest commit, and a merge basis from the request document covers this task.

- The proof covers every change in the diff.
- Required checks are green.
- Review bots have finished, and each finding is fixed or dismissed with a written reason.
- No human review still requests changes.
- The branch is up to date with the default branch and reported mergeable.

Merge with the method the repository uses. Never bypass branch protection. Run a fetch and check the pull request again immediately before merging, and stay until the platform reports it merged when a queue or auto-merge is in play.

## Report

Write `05-ship.md` with the pull request link, the merge commit or the reason the work stopped at a ready pull request, the proof, and every decision made for the user. Stop when it is saved. Do not hand off again.
