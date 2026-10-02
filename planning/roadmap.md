# Roadmap: git, cloud and subscriptions

The order of the work in [git-integration.md](git-integration.md), [cloud-platform.md](cloud-platform.md) and [subscriptions.md](subscriptions.md). Sizes are rough (one developer with AI help).

## Rule

**Local features first** (the owner's instruction, 2026-10-01). Git Phases 1–3 are local and can go into the normal feature work. Cloud (C0 onward) and subscriptions start only when the owner decides; when the local backlog is done, remind the owner.

## Milestones

| # | Milestone | Items | Needs | Size |
|---|---|---|---|---|
| M1 | **Git-friendly workspaces** | GIT-101…105 | — | 2–3 weeks |
| M2 | **Git panel** | GIT-201…210 | M1 | 4–6 weeks |
| M3 | **Smart merging + AI / CLI** | GIT-301, 302, 304, 401…403 | M2 | 3–4 weeks |
| — | *Owner decision: start the cloud* | | | |
| M4 | **Cloud foundations** (local refactors) | CLD-001…005, SUB-001…002 | M1 | 5–8 weeks |
| M5 | **Accounts and organizations** | CLD-101…105 | M4 | 4–6 weeks |
| M6 | **Sharing and Free + Pro launch** | CLD-201…205, SUB-101…104 | M5 | 5–7 weeks |
| M7 | **Sync and collaboration** | CLD-301…305 | M6, GIT-301 | 6–10 weeks |
| M8 | **Cloud execution** | CLD-401…406 | M6 | 6–8 weeks |
| M9 | **Team plan** | SUB-201…203, CLD-501…502, CLD-601 | M7 | 4–6 weeks |
| M10 | **Enterprise** | CLD-503…505, CLD-602…603, SUB-301…302 | M9 | 8–12 weeks |

## Dependencies worth knowing

- **GIT-101 (stable files) comes first for everything:** git diffs, the merge driver and cloud sync all need item-level changes without `version` / `updatedAt` noise.
- **GIT-301 (merge by id) and CLD-301 (sync)** share the same merge logic: build it once in `packages/core` (`mergeCollection(base, ours, theirs)`).
- **CLD-001 (permission-aware RPC context)** is a refactor of every handler: do it before any cloud UI.
- **GIT-103 (watching files)** gives the event stream that cloud live updates (CLD-303) reuse.

## What can be done now, without the cloud

M1–M3, plus the local parts of M4 (CLD-001, CLD-002), are useful today: they make TestPion work well with git for teams who already share workspaces through repositories, and they prepare the code for the cloud.
