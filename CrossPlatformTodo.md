# Cross Platform Support Todo

## Objective
Add reliable Windows and Linux support to the desktop app while preserving current macOS behavior.

## Scope
- Make scripts shell-agnostic across macOS, Windows, Linux.
- Keep discovery defaults as-is in core, but add user-editable and persisted overrides in desktop settings.
- Ensure renderer and main process handle platform-specific UI/runtime behavior cleanly.
- Add packaging targets and CI coverage for all 3 OSes.

## Non-Goals
- Do not change core default discovery paths in `packages/core`.
- Do not redesign non-settings UI unless required for platform correctness.

## Workstream 1: Script Portability
### Tasks
- Update root scripts in `package.json`:
  - Convert `test` and `test:watch` away from POSIX env prefix syntax.
- Update desktop scripts in `apps/desktop/package.json`:
  - Convert `verify:native` and `rebuild:native` away from POSIX env prefix syntax.
- Use `cross-env` and/or Node wrapper scripts for env setup (`HOME`, `USERPROFILE`, `npm_config_devdir`, `ELECTRON_RUN_AS_NODE`).

### Deliverables
- Cross-platform-safe script commands.
- Any helper script(s) in `apps/desktop/scripts/` if needed.

### Acceptance Criteria
- Scripts run from:
  - macOS zsh
  - Linux bash
  - Windows PowerShell/cmd
- No shell syntax errors caused by env var assignment style.

## Workstream 2: Persisted Discovery Overrides
### Tasks
- Keep defaults in:
  - `packages/core/src/discovery/discoverSessionFiles.ts`
- Add persisted discovery overrides to desktop app state:
  - `apps/desktop/src/main/appStateStore.ts`
- Add IPC contract channels for read/update discovery config:
  - `packages/core/src/contracts/ipc.ts`
- Implement IPC handlers:
  - `apps/desktop/src/main/bootstrap.ts`
- Ensure indexing runner uses merged config (`defaults + overrides`):
  - `apps/desktop/src/main/indexingRunner.ts`

### Data Model Requirements
- Persist only explicit user overrides.
- Validate/sanitize path strings and booleans.
- Keep backward compatibility with existing `ui-state.json`.

### Acceptance Criteria
- User-defined discovery paths survive app restart.
- Refresh/indexing uses overridden paths.
- Clearing overrides falls back to defaults.

## Workstream 3: Settings UI for Discovery Paths
### Tasks
- Add editable discovery fields in settings:
  - `apps/desktop/src/renderer/components/SettingsView.tsx`
- Add Save and Reset-to-default actions.
- Wire fetch/save flows in:
  - `apps/desktop/src/renderer/App.tsx`
- Add any styling updates in:
  - `apps/desktop/src/renderer/styles.css`

### UX Requirements
- Show current effective values.
- Show loading/saving states.
- Show inline error/success messages.
- Keep existing dark/light redesign visual language.

### Acceptance Criteria
- User can edit and save discovery paths from Settings.
- New values are used after refresh without requiring app reinstall.
- Reset restores default values.

## Workstream 4: Platform Runtime Plumbing
### Tasks
- Expose platform via preload API:
  - `apps/desktop/src/preload/index.ts`
- Update renderer global typings:
  - `apps/desktop/src/renderer/global.d.ts`
- Replace UA sniffing with platform API:
  - `apps/desktop/src/renderer/main.tsx`
- Add body classes:
  - `platform-macos`
  - `platform-windows`
  - `platform-linux`

### Acceptance Criteria
- Correct platform class is applied on each OS.
- No platform detection based on browser UA string.

## Workstream 5: Window Chrome and Topbar Behavior
### Tasks
- Decide and implement one consistent strategy in:
  - `apps/desktop/src/main/main.ts`
  - `apps/desktop/src/renderer/styles.css`
- Recommended strategy:
  - Keep macOS custom titlebar behavior (`hiddenInset` path).
  - Keep native frame on Windows/Linux unless there is a clear need for custom controls.

### Acceptance Criteria
- No duplicate titlebars.
- Drag regions and controls behave correctly on each OS.

## Workstream 6: Packaging Targets
### Tasks
- Extend makers in:
  - `apps/desktop/forge.config.ts`
- Add scripts in:
  - `apps/desktop/package.json`
  - `make:win`
  - `make:linux`

### Acceptance Criteria
- Build artifacts are generated for macOS, Windows, Linux from appropriate runners.

## Workstream 7: Test and CI Matrix
### Tasks
- Add/extend tests:
  - `apps/desktop/src/main/ipc.test.ts`
  - `apps/desktop/src/main/appStateStore.test.ts`
- Add CI matrix for:
  - macOS
  - Windows
  - Linux
- Validate:
  - lint
  - typecheck
  - unit tests
  - desktop build
  - native module verification

### Acceptance Criteria
- Green CI on all 3 OS targets.
- Discovery override behavior covered by tests.

## Suggested PR Sequence
1. PR1: Script portability (`cross-env` or wrappers).
2. PR2: Discovery override persistence + IPC + indexer wiring.
3. PR3: Settings UI for editing discovery paths.
4. PR4: Platform API and renderer/platform class cleanup.
5. PR5: Window chrome refinements for Win/Linux.
6. PR6: Packaging makers and scripts for Win/Linux.
7. PR7: CI matrix and test hardening.

## Definition of Done
- Developers can run test/build commands on macOS, Windows, Linux without shell issues.
- Users can edit discovery paths in Settings and those values persist.
- Indexing reads from configured discovery roots.
- App runtime/platform UI behavior is correct per OS.
- Packaging and CI support all three OSes.

## Handoff Note for Future Coding Assistant
When implementing, do not batch all work in one change. Follow the PR sequence above, and ensure each PR has:
- focused file scope
- tests for new behavior
- explicit acceptance criteria verification
