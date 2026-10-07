---
name: sync-docs
description: Close out a piece of Tahansoe work by bringing the docs in line with the code — update docs/status.md, PRD milestone checkboxes, specs, architecture, security findings, and README. Use at the end of any task that changed behavior, structure, contracts, or setup.
---

# Sync docs

Run at the end of a task, before the final commit.

1. **See what changed.** `git diff --stat` and `git diff` against the branch base (or the commits made in this task).
2. **status.md.** In `docs/status.md`: move finished items to "Sudah jalan", tick or remove gaps that were closed, add new gaps you discovered, refresh "Next steps", and update the `Last updated` date.
3. **PRD milestones.** Tick the matching checkboxes in `docs/prd.md` §10. Do not change PRD scope here; scope changes need the owner's agreement.
4. **Spec.** If a spec in `docs/specs/` covers this work, set its status and record where the implementation differs from the plan.
5. **Architecture.** If folders, modules, tables, interfaces, env vars, or data flows changed, update `docs/architecture.md` (remove "(rencana)" for things now built).
6. **Security.** If you fixed or found a security issue, update the table in `docs/security.md` §3.
7. **Contracts.** If a contract was redeployed or its interface changed, update `contracts/README.md` (addresses, commands).
8. **README.** If setup, env vars, or commands changed, update `README.md`.
9. **Consistency pass.** Grep for statements now false (e.g. `grep -rn "Safe Module\|flash loan\|Base" docs README.md components/landing`) and fix or report them.
10. **Report** to the user which documents were updated, in one short list.
