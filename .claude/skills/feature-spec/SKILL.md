---
name: feature-spec
description: Start a new Tahansoe feature the right way — map it to a PRD milestone, check non-goals and invariants, and write a spec in docs/specs/ from the template before writing code. Use when beginning any non-trivial feature (more than one file, or anything touching contracts, engine, keeper, auth, or DB schema).
---

# Feature spec

Follow these steps before implementing.

1. **Load context.** Read `AGENTS.md`, `docs/status.md`, and the PRD sections relevant to the feature (`docs/prd.md`). Skim `docs/architecture.md` §2 (repo layout) and §5 (data model).
2. **Map to the roadmap.** Find the milestone in `docs/prd.md` §10 this feature belongs to. If none fits, or it touches a non-goal in §11, stop and ask the user before continuing.
3. **Check decisions.** Read the ADR index in `docs/decisions/README.md`. If the feature changes chain strategy, the security model, the AI boundary, repo structure, or adds a major dependency/provider, draft a new ADR from `docs/decisions/0000-template.md` (status `Proposed`) and add it to the index.
4. **Write the spec.** Copy `docs/specs/_template.md` to `docs/specs/m<N>-<feature-name>.md` and fill every section:
   - Scope: list what is explicitly out of scope.
   - Design: files to create/change, interfaces (use the canonical names from PRD §6.3/§7), DB changes.
   - Security impact: answer each item of `docs/security.md` §4.
   - Acceptance criteria: concrete and testable.
   - Test plan: unit / fork / manual steps.
5. **Confirm.** Show the user a short summary of the spec (goal, scope, open questions) and get agreement on open questions before implementing.
