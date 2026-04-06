# Explore Runner: AI-Driven On-Demand QA for Positron

## The Problem

Manual QA testing is slow and doesn't scale. We wanted AI (Claude Code) to drive Positron through ad-hoc test scenarios without writing full e2e test files -- just describe what to test in natural language.

## Approaches Explored

### 1. MCP Server (Initial Direction)

**Idea:** Build custom MCP tool modules (Console, Variables, Sessions, Data Explorer, Plots) that expose Positron actions as MCP tools. Claude Code calls them natively via its MCP client.

**Pros:**
- Native Claude Code integration -- no HTTP plumbing
- Each tool is self-documenting with schemas
- Claude sees tools in its tool list automatically

**Cons:**
- **Duplicate maintenance** -- every POM method needs a parallel MCP tool wrapper. As POMs change, MCP tools drift
- **No Playwright test infrastructure** -- no traces, no reports, no screenshots, no built-in waits/retries
- **Cold start** -- MCP server needs its own Electron launch mechanism, separate from the e2e test harness
- **No batching** -- one MCP tool call per round-trip

**Verdict:** Too much duplication. We'd be rebuilding what Playwright already provides.

### 2. Playwright CLI (`npx playwright --ui` / `playwright-cli` skill)

**Idea:** Use Playwright's built-in browser automation CLI. Claude sends commands like `click <ref>`, `type <text>`, `snapshot` to drive the browser.

**Pros:**
- Zero custom code -- works out of the box
- Full page visibility via accessibility snapshots
- Flexible -- can interact with any UI element

**Cons:**
- **~15 tool calls for 3 logical steps** -- high overhead. Every action requires: snapshot -> find element -> click -> snapshot again (refs change after every DOM update)
- **No POM reuse** -- all our existing Page Object Model methods (with built-in waits, retries, complex flows) are bypassed
- **Snapshot noise** -- ~390 lines / ~5K tokens per snapshot, mostly irrelevant
- **Monaco quirks** -- editor interactions need `force: true`, hidden textareas, mouse position hacks
- **No structured assertions** -- have to grep through YAML snapshots instead of `expectVariableToBe("x", "42")`

**Verdict:** Works but extremely chatty. The AI spends more time navigating the DOM than testing. Felt slow.

### 3. Explore Runner (What We Built)

**Idea:** An HTTP server that runs *inside* a Playwright test, exposing POM methods via REST API reflection. Claude Code sends high-level commands; the server calls the real POMs.

**Pros:**
- **Full POM reuse** -- every existing Page Object method works via reflection. No wrappers to maintain
- **Auto-discovery** -- catalog is built at startup from prototype reflection, including sub-objects (e.g. `dataExplorer.grid`, `dataExplorer.summaryPanel`). Methods never go stale
- **Playwright infrastructure** -- traces, HTML reports, screenshots, step hierarchy, built-in waits/retries all work
- **Batching** -- send multiple steps in one request, ~3 round-trips instead of 15
- **3-tier action model**: POM calls (reflection), Custom actions (multi-step flows like `newNotebook`, `contextMenu`), Raw Playwright (fallback for recovery)
- **Works in Electron and browser modes** -- same test, different `--project` flag

**Cons:**
- Custom HTTP server (~200 lines) needs maintenance
- Skill documentation (SKILL.md) needs to stay accurate
- AI still needs retries when it guesses wrong parameter types (catalog shows names, not TypeScript union types)

### 4. Expect (github.com/millionco/expect)

**Idea:** An open-source CLI that reads git diffs, generates a test plan via AI, then executes via Playwright headless with real browser auth (cookie extraction from Chrome/Firefox/Safari profiles). Uses Agent Client Protocol (ACP) to invoke any agent (Claude, Copilot, Gemini) as a subprocess.

**Pros:**
- **Change-driven** -- reads diffs and tests what changed, great for PR validation
- **Agent-agnostic** -- not locked to Claude, supports any ACP-compatible agent
- **CI-native** -- headless with exit codes, designed for automation
- **Real auth** -- extracts cookies from browser profiles, no login flows
- **Multi-browser** -- Chrome, Firefox, Safari support
- **rrweb recordings** -- session replay for debugging

**Cons:**
- **No POM reuse** -- generates raw Playwright code from scratch every time. Doesn't know about our 50+ Page Object classes with built-in waits, retries, and complex flows
- **Not IDE-aware** -- has no concept of Positron sessions, console, Variables pane, Data Explorer sub-objects
- **Different use case** -- optimized for "did this PR break anything?" not "does this issue repro?"
- **Raw DOM interaction** -- for a complex IDE like Positron with native menus, Monaco editors, and custom widgets, this is fragile and verbose (same problem as the Playwright CLI approach)

**Verdict:** Strong tool for generic web app PR validation. But for Positron-specific QA, it would throw away our POM library and fight the same DOM complexity we already solved.

**Could complement the explore runner:** Expect for CI-gate regression detection from diffs, explore runner for interactive QA and issue reproduction during development. If we wanted CI integration later, we could expose the explore runner's HTTP API to an external agent (like Expect's ACP agents) rather than rebuilding the POM layer.

## Comparison Summary

| Dimension | MCP Server | Playwright CLI | Expect | Explore Runner |
|-----------|-----------|----------------|--------|----------------|
| Trigger | Manual | Manual | Git diffs | Natural language / issues |
| POM reuse | None (duplicate tools) | None (raw DOM) | None (generated code) | Full (reflection) |
| Maintenance | High (tool per method) | Zero | Zero | Low (~200 lines server) |
| Round-trips per test | 8-15 | 15+ | N/A (autonomous) | 2-4 (batching) |
| Assertions | Custom (no retries) | Grep through YAML | Generated | POM `expect*` methods |
| Reports/traces | None | None | rrweb recordings | Playwright HTML reports |
| Discovery | Manual tool schemas | Accessibility snapshots | AI from diffs | Auto-generated catalog |
| Agent | Claude only | Claude only | Any (ACP) | Claude only |
| Multi-browser | Custom setup each | Browser only | Yes | Electron + browser |
| CI ready | No | No | Yes | Not yet |

## v2: Run-Plan Architecture (2026-04)

The original explore runner used per-step HTTP calls (2-4 round-trips via `/batch`).
v2 adds a `/run-plan` endpoint that executes the entire test in one HTTP call,
with per-step timeouts, state reset between retries, and an enriched observer.

See `docs/superpowers/specs/2026-04-03-qa-test-v2-design.md` for the full spec.

Key additions:
- `POST /run-plan` -- one-shot test execution with structured report
- `state-reset.ts` -- best-effort cleanup between retry attempts
- `scripts/generate-pom-reference.ts` -- type-rich POM API reference for AI
- Enriched observer with variable names, session status, notifications, tabs
- Per-step timeout overrides (default 10s, configurable per step)
- Retry budget of 2 attempts with automatic state reset
