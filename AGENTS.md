# pi-my-workbench

This is a thin Pi package, not a fork or source mirror of its four upstream extensions.

- Keep upstream implementations in their original repositories. Pin Git dependencies to full commits and npm dependencies to exact versions; update package-lock.json and upstreams.json together.
- Declare separate resource entry points. Do not collapse modules into one factory or bundle host-provided Pi APIs.
- The model-overrides module is opt-in. Personal model lists, credentials, settings, development paths and runtime state must never be committed.
- Local development links may change only this checkout's node_modules and ignored .workbench directory. Never edit, reset or commit upstream worktrees from a management script.
- Use Node's built-in test runner. Tests must not call a model, query account quotas, send a prompt or start external services.
- Run npm run verify before publishing changes. Packaging must refuse active development links.
- Do not publish to npm, push commits or change a user's Pi settings without task-specific authorization.
