# pstack (vendored)

`.claude/skills`, `.claude/agents`, `.claude/docs`, and this folder are copied from [cursor/plugins](https://github.com/cursor/plugins) `harness/pstack/claude-code` at [`e73df471cd4b`](https://github.com/cursor/plugins/tree/e73df471cd4bd918367e99f3dd9c51bd53ddf5f0/harness/pstack/claude-code) (pstack 0.15.32), under the [MIT license](LICENSE). Do not edit them by hand. Run `node scripts/sync-pstack.mjs` to update (`--ref <commit>` picks a version), which re-applies the local patches in that script, and `node scripts/sync-pstack.mjs --remove` to remove pstack. The guide's images are linked from upstream at this commit instead of copied.

[`manifest.json`](manifest.json) lists what pstack owns. The sync replaces only those entries, so this repository's own skills and agents in `.claude/` and `.claude/rules/pstack-models.md`, its own model choice, are left alone by a sync. `--remove` deletes that rule too.
