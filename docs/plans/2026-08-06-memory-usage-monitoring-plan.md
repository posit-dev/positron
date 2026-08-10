# Memory Usage Monitoring Implementation Plan (Positron side)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure idle Positron's memory footprint broken down per process, publish it nightly, and render a per-run report on the GitHub run page.

**Architecture:** An e2e spec launches a released Positron build three times, waits for it to settle, and samples the process tree. Per-process memory (PSS) comes from procfs; process *names* come from Positron's own `--status` CLI, because several utility processes have identical command lines. The two are joined on PID, labeled into a fixed role vocabulary, and rendered to a step summary plus an HTML artifact. Fragile parsing and all labeling live in small pure modules with unit tests.

**Tech Stack:** TypeScript, Playwright (e2e), Vitest (unit), GitHub Actions, procfs (`smaps_rollup`), undici.

Design spec: `docs/design/2026-08-06-memory-usage-monitoring-design.md`
Issue: posit-dev/positron#15001

**Scope:** This plan covers the Positron repository only. The `/memory` API endpoint and the dashboard Memory sub-tab live in `posit-dev/e2e-test-insights` and are a separate plan. Task 9 defines the payload contract that plan must implement. Until it exists, publishing fails soft and everything else still works.

## Global Constraints

- Tabs for indentation in TypeScript/JavaScript, never spaces.
- ASCII punctuation only. No em-dashes, en-dashes, smart quotes.
- Positron-owned new files only. Do not modify upstream VS Code files in `src/vs/`. If unavoidable, wrap in `// --- Start Positron ---` / `// --- End Positron ---`.
- Every new file needs the Posit copyright header (copy from a neighboring `test/e2e` file).
- Vitest files use the `.vitest.ts` extension. Run them with `npx vitest run <path>`. They do not need build daemons.
- Run `npm run precommit -- <files>` before each commit; the hook checks unicode, indentation, headers, formatting, and eslint.
- Memory is measured as **PSS**, not RSS. RSS is recorded alongside but never summed.
- `process_role` values come from a fixed vocabulary. Never put a window title, PID, or any high-cardinality string in it.
- Linux only. Do not add macOS or Windows branches; they are explicitly deferred.

## File Structure

| File | Responsibility |
| --- | --- |
| `test/e2e/utils/memory/types.ts` | Shared types for the whole collector |
| `test/e2e/utils/memory/label.ts` | Pure: process name/argv to `ProcessRole` |
| `test/e2e/utils/memory/label.vitest.ts` | Unit tests for the role map |
| `test/e2e/utils/memory/process-tree.ts` | procfs walk and parsers (PSS, RSS, PPid) |
| `test/e2e/utils/memory/process-tree.vitest.ts` | Unit tests for the procfs parsers |
| `test/e2e/utils/memory/positron-status.ts` | Run `--status`, parse to a pid-to-name map |
| `test/e2e/utils/memory/positron-status.vitest.ts` | Unit tests for the `--status` parser |
| `test/e2e/utils/memory/snapshot.ts` | Settle-poll, sample, join, emit a `MemorySnapshot` |
| `test/e2e/utils/memory/extensions.ts` | Read activated extensions from the extension host log |
| `test/e2e/utils/memory/render.ts` | Pure: snapshot (+ baseline) to markdown and HTML |
| `test/e2e/utils/memory/render.vitest.ts` | Unit tests for both renderers |
| `test/e2e/utils/memory/publish.ts` | Batched POST and baseline GET against `/memory` |
| `test/e2e/utils/memory/fixtures/*.txt` | Captured real output used by the parser tests |
| `test/e2e/tests/performance/memory-idle.test.ts` | The spec that drives it |
| `test/e2e/fixtures/settingsMemory.json` | Pre-launch settings that make idle actually idle |
| `test/e2e/fixtures/test-setup/shared-utils.ts` | Modified: merge the memory settings when `MEMORY_SCENARIO=idle` |
| `vitest.config.ts` | Modified: include `test/e2e/**/*.vitest.ts` |
| `vitest.tsconfig.json` | Modified: same include, or the type check silently skips them |
| `.github/scripts/release-screenshots/download-build.sh` | Modified: handle Linux tarballs, not just macOS zips |
| `.github/workflows/test-memory-metrics.yml` | Nightly and dispatch workflow |

---

### Task 1: Spike - confirm `--status` reaches an e2e-launched Positron

Everything downstream assumes we can get Positron to name its own processes. If the CLI cannot reach an instance launched by the e2e harness, the labeling approach needs rethinking, and we want to know that now rather than after building six modules.

This task writes no production code. It produces a captured fixture and a go/no-go answer.

**Files:**
- Create: `test/e2e/utils/memory/fixtures/status-linux.txt`
- Create: `test/e2e/utils/memory/fixtures/smaps_rollup.txt`
- Create: `test/e2e/utils/memory/fixtures/proc-status.txt`

**Interfaces:**
- Consumes: nothing
- Produces: fixture files used by Tasks 3 and 4. No code.

- [ ] **Step 1: Launch a Positron build and find its main PID**

Use an existing build (a downloaded release, or `.build/electron` from a local dev build). Launch it with an isolated user data directory so it does not collide with your daily Positron:

```bash
BUILD_DIR=/path/to/positron-build
UDD=/tmp/positron-memory-spike
rm -rf "$UDD"
"$BUILD_DIR/positron" --user-data-dir="$UDD" --extensions-dir="$UDD/exts" &
sleep 25
pgrep -f "user-data-dir=$UDD" | head -1
```

- [ ] **Step 2: Find the CLI entry point**

Already answered by Task 10, which was executed first: on Linux the CLI is `bin/positron`. (The macOS bundle ships it as `bin/code` instead, which is why `resolveCliPath` in Task 4 keeps both candidates even though only the Linux name matters here.)

Confirm it is present in the build you are about to launch:

```bash
ls "$BUILD_DIR/bin/"
```

Expected: `positron`.

- [ ] **Step 3: Run `--status` against the running instance and capture it**

```bash
"$BUILD_DIR/bin/positron" --user-data-dir="$UDD" --status > test/e2e/utils/memory/fixtures/status-linux.txt 2>&1
cat test/e2e/utils/memory/fixtures/status-linux.txt
```

Expected: a `CPU %	Mem MB	   PID	Process` header followed by one row per process, with names like `positron`, `gpu-process`, `utility-network-service`, `window [1] (...)`, `shared-process`, `file-watcher [1]`, `pty-host`, `extension-host [1]`.

**This is the gate.** If the command instead prints usage text, hangs, or starts a second Positron window, stop and report. Do not proceed to Task 2 until real output is captured.

Executed, and the gate passes: the fixtures in `test/e2e/utils/memory/fixtures/` come from Positron 2026.08.0-331 (linux arm64) running under Xvfb in `mcr.microsoft.com/playwright:v1.55.0-jammy`. Two things had to be right, and both cost a run each:

- **`DISPLAY` must be set for the `--status` call, not just for the app.** The CLI services `--status` by spawning a *child* Electron main process (`cli.ts` line 249 pipes that child's stdout). With no display the child dies during GTK init and the CLI exits 0 having printed nothing at all - no error, no usage text. Launching the app with `xvfb-run` and then calling the CLI outside it reproduces this every time. Start one `Xvfb :99` and export `DISPLAY` for both.
- **Do not run as root.** As root, Electron's super-user guard demands `--no-sandbox` on every invocation including the CLI's; as a normal user without `--no-sandbox` the sandbox cannot start. Run as a non-root user *and* pass `--no-sandbox`.

`VSCODE_IPC_HOOK_CLI` turned out to be a red herring: no `vscode-ipc-*.sock` exists at idle and no child carries that variable. `--status` is routed through the user-data-dir handle, so `--user-data-dir` is the only thing that has to match.

The captured table also contains two names the sample below does not: `zygote` (twice) and `.../json-language-features/.../jsonServerMain`. Both resolve to `unlabeled`, which is the intended behaviour - the vocabulary stays fixed and unclassified processes stay visible as a gap. Revisit only if Task 9's unattributed-memory gate starts tripping.

Ignore the `Mem MB` column entirely. It is known-broken (issue #15382) and we never read it.

- [ ] **Step 4: Capture procfs fixtures for the same instance**

```bash
MAIN_PID=$(pgrep -f "user-data-dir=$UDD" | head -1)
cat /proc/$MAIN_PID/smaps_rollup > test/e2e/utils/memory/fixtures/smaps_rollup.txt
cat /proc/$MAIN_PID/status | head -20 > test/e2e/utils/memory/fixtures/proc-status.txt
head -5 test/e2e/utils/memory/fixtures/smaps_rollup.txt
grep PPid test/e2e/utils/memory/fixtures/proc-status.txt
```

Expected: `smaps_rollup.txt` contains `Rss:` and `Pss:` lines in kB. `proc-status.txt` contains a `PPid:` line.

If `smaps_rollup` does not exist, the kernel is too old (pre-4.14). Report this; the fallback is summing `Pss` from the much larger `/proc/<pid>/smaps`.

- [ ] **Step 5: Clean up and commit the fixtures**

```bash
pkill -f "user-data-dir=$UDD"
git add test/e2e/utils/memory/fixtures/
git commit -m "test: capture real process diagnostics fixtures for memory metrics"
```

---

### Task 2: Role vocabulary and the labeler

The single piece anyone will maintain. Pure function, no I/O.

**Files:**
- Create: `test/e2e/utils/memory/types.ts`
- Create: `test/e2e/utils/memory/label.ts`
- Create: `test/e2e/utils/memory/label.vitest.ts`
- Modify: `vitest.config.ts`, `vitest.tsconfig.json`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type ProcessRole` (union of the 14 role strings below)
  - `resolveRole(input: { positronName?: string; cmd: string; isRoot: boolean }): { role: ProcessRole; labeled: boolean }`
  - `type RawProcess`, `type LabeledProcess`, `type MemorySnapshot` in `types.ts`

- [ ] **Step 1: Extend the vitest include glob**

In `vitest.config.ts`, change the `include` array to add the e2e path:

```ts
		include: [
			'src/vs/**/*.vitest.{ts,tsx}',
			'src/*.vitest.{ts,tsx}',
			'test/e2e/**/*.vitest.{ts,tsx}'
		],
```

- [ ] **Step 2: Write the types**

Create `test/e2e/utils/memory/types.ts` (copy the copyright header from `test/e2e/utils/metrics/metric-base.ts`):

```ts
export type ProcessRole =
	| 'main'
	| 'renderer'
	| 'gpu'
	| 'network'
	| 'shared'
	| 'extension_host'
	| 'pty_host'
	| 'file_watcher'
	| 'agent_host'
	| 'kernel_supervisor'
	| 'kernel'
	| 'language_server'
	| 'extension_child'
	| 'unlabeled';

/** One process as read from procfs, before naming or labeling. */
export type RawProcess = {
	pid: number;
	ppid: number;
	cmd: string;
	pssBytes: number;
	rssBytes: number;
};

/** One process after joining with Positron's names and resolving a role. */
export type LabeledProcess = {
	pid: number;
	ppid: number;
	depth: number;
	processName: string;
	processRole: ProcessRole;
	labeled: boolean;
	cmdBasename: string;
	pssBytes: number;
	rssBytes: number;
	pssMin: number;
	pssMax: number;
};

/** Everything one app launch produced. */
export type MemorySnapshot = {
	scenario: 'idle';
	launchIndex: number;
	settleMs: number;
	treeTotalPssBytes: number;
	processes: LabeledProcess[];
	extensions: ActivatedExtension[];
};

export type ActivatedExtension = {
	extensionId: string;
	isBuiltin: boolean;
	activationTimeMs: number | null;
	activationEvent: string | null;
};
```

- [ ] **Step 3: Write the failing tests**

Create `test/e2e/utils/memory/label.vitest.ts`. Every expected name below is copied from real `--status` output, not invented:

```ts
import { describe, expect, test } from 'vitest';
import { resolveRole } from './label.js';

describe('resolveRole', () => {
	test('names the root process main', () => {
		const { role, labeled } = resolveRole({ positronName: 'positron', cmd: '/opt/positron/positron', isRoot: true });
		expect(role).toBe('main');
		expect(labeled).toBe(true);
	});

	test.each([
		['gpu-process', 'gpu'],
		['utility-network-service', 'network'],
		['shared-process', 'shared'],
		['pty-host', 'pty_host'],
		['window [1] (Welcome)', 'renderer'],
		['window [2] (some-other-title)', 'renderer'],
		['file-watcher [1]', 'file_watcher'],
		['extension-host [1]', 'extension_host'],
		['agent-host', 'agent_host'],
	])('maps the Positron name %s to %s', (positronName, expected) => {
		const { role, labeled } = resolveRole({ positronName, cmd: 'whatever', isRoot: false });
		expect(role).toBe(expected);
		expect(labeled).toBe(true);
	});

	test('window titles do not leak into the role', () => {
		const a = resolveRole({ positronName: 'window [1] (Welcome)', cmd: 'x', isRoot: false });
		const b = resolveRole({ positronName: 'window [1] (my-project)', cmd: 'x', isRoot: false });
		expect(a.role).toBe(b.role);
	});

	test('falls back to argv for a renderer Positron did not name', () => {
		const { role, labeled } = resolveRole({
			cmd: '/opt/positron/positron --type=renderer --standard-schemes=vscode-webview',
			isRoot: false
		});
		expect(role).toBe('renderer');
		expect(labeled).toBe(false);
	});

	test('recognises the kernel supervisor by executable', () => {
		const { role } = resolveRole({
			cmd: '/opt/positron/resources/app/extensions/positron-supervisor/resources/kallichore/kcserver --log-level debug',
			isRoot: false
		});
		expect(role).toBe('kernel_supervisor');
	});

	test('recognises a language server child', () => {
		const { role } = resolveRole({ positronName: 'electron-nodejs (language-server.js)', cmd: 'node language-server.js', isRoot: false });
		expect(role).toBe('language_server');
	});

	test('an unnamed NodeService utility is unlabeled, never guessed', () => {
		const { role, labeled } = resolveRole({
			cmd: '/opt/positron/positron --type=utility --utility-sub-type=node.mojom.NodeService --lang=en-US',
			isRoot: false
		});
		expect(role).toBe('unlabeled');
		expect(labeled).toBe(false);
	});

	test('a completely unknown process is unlabeled rather than throwing', () => {
		const { role, labeled } = resolveRole({ cmd: '/usr/bin/something-new-nobody-predicted', isRoot: false });
		expect(role).toBe('unlabeled');
		expect(labeled).toBe(false);
	});

	test('a process Positron names but we have not mapped stays unlabeled, and records that it was named', () => {
		// The most useful failure mode. Positron introducing a new named
		// utility should surface as "we know what it is called and have not
		// mapped it yet", which is a far better prompt than a generic bucket.
		const { role, labeled } = resolveRole({ positronName: 'some-new-host [1]', cmd: 'positron --type=utility', isRoot: false });
		expect(role).toBe('unlabeled');
		expect(labeled).toBe(true);
	});
});
```

The last two tests are the important ones. They encode the rule that an unrecognised process degrades visibly instead of being guessed into a neighbouring bucket.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run test/e2e/utils/memory/label.vitest.ts`
Expected: FAIL, cannot resolve `./label.js`.

- [ ] **Step 5: Implement the labeler**

Create `test/e2e/utils/memory/label.ts`:

```ts
import { ProcessRole } from './types.js';

/**
 * Ordered rules matched against the name Positron reports via `--status`.
 * First match wins, so put more specific patterns first.
 */
const NAME_RULES: [RegExp, ProcessRole][] = [
	[/^gpu-process$/, 'gpu'],
	[/^utility-network-service$/, 'network'],
	[/^shared-process$/, 'shared'],
	[/^pty-host$/, 'pty_host'],
	[/^agent-host$/, 'agent_host'],
	[/^file-watcher\b/, 'file_watcher'],
	[/^extension-host\b/, 'extension_host'],
	[/^window\b/, 'renderer'],
	[/language-server/, 'language_server'],
	[/^electron-nodejs\b/, 'extension_child'],
];

/**
 * Ordered rules matched against the raw command line. Only used for process
 * types argv genuinely distinguishes. The `node.mojom.NodeService` utilities
 * are deliberately absent: several of them share an identical command line, so
 * any rule here would be a coin flip.
 */
const CMD_RULES: [RegExp, ProcessRole][] = [
	[/--type=renderer\b/, 'renderer'],
	[/--type=gpu-process\b/, 'gpu'],
	[/--utility-sub-type=network\.mojom\.NetworkService/, 'network'],
	[/\/kcserver\b/, 'kernel_supervisor'],
	[/supervisor-wrapper\.sh/, 'kernel_supervisor'],
	[/\bipykernel_launcher\b|\/ark\b/, 'kernel'],
	[/language-server/, 'language_server'],
];

function firstMatch(rules: [RegExp, ProcessRole][], subject: string): ProcessRole | undefined {
	for (const [pattern, role] of rules) {
		if (pattern.test(subject)) {
			return role;
		}
	}
	return undefined;
}

/**
 * Resolve a process role. `labeled` records whether Positron itself named the
 * process, which is independent of whether we managed to classify it: argv can
 * identify a renderer that Positron did not name.
 *
 * An unclassifiable process becomes `unlabeled` rather than being folded into a
 * neighbouring role. That is deliberate. A new unnamed process should show up
 * as a visible gap in the chart, not silently inflate another bucket.
 */
export function resolveRole(input: { positronName?: string; cmd: string; isRoot: boolean }): { role: ProcessRole; labeled: boolean } {
	const labeled = !!input.positronName;

	if (input.isRoot) {
		return { role: 'main', labeled };
	}

	const byName = input.positronName ? firstMatch(NAME_RULES, input.positronName) : undefined;
	if (byName) {
		return { role: byName, labeled };
	}

	const byCmd = firstMatch(CMD_RULES, input.cmd);
	if (byCmd) {
		return { role: byCmd, labeled };
	}

	return { role: 'unlabeled', labeled };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/e2e/utils/memory/label.vitest.ts`
Expected: PASS, 17 tests (the 9-row `test.each` counts as 9).

Note there is deliberately no `utility_other` role. Every path that would have
produced it produces `unlabeled` instead, and a bucket nothing can emit is just a
second name for the same thing with worse grouping behaviour.

- [ ] **Step 7: Check types and commit**

`vitest.tsconfig.json` only includes `src/`, so without also extending its
`include` the type check skips these files entirely and reports success without
having looked at them. Add `"test/e2e/**/*.vitest.ts"` to its `include` array
alongside the `vitest.config.ts` change from Step 1.

Prove the check is actually reading the new files rather than trusting a clean
result, by appending a deliberate error and confirming it is caught:

Use a throwaway probe file, never the real one. At this point `label.vitest.ts` is
new and uncommitted, so `git checkout --` either fails outright (untracked) or
discards the work it is meant to protect (tracked but uncommitted):

```bash
cat > test/e2e/utils/memory/probe.vitest.ts <<'PROBE'
const deliberateTypeError: number = "not a number";
PROBE
npm run test:positron:check-ts 2>&1 | grep 'probe.vitest'   # must report TS2322
rm test/e2e/utils/memory/probe.vitest.ts
```

```bash
npm run test:positron:check-ts 2>&1 | grep 'test/e2e' || echo "no type errors"
npm run precommit -- vitest.config.ts test/e2e/utils/memory/types.ts test/e2e/utils/memory/label.ts test/e2e/utils/memory/label.vitest.ts
git add vitest.config.ts test/e2e/utils/memory/
git commit -m "test: add process role labeler for memory metrics"
```

---

### Task 3: procfs process tree reader

**Files:**
- Create: `test/e2e/utils/memory/process-tree.ts`
- Create: `test/e2e/utils/memory/process-tree.vitest.ts`

**Interfaces:**
- Consumes: `RawProcess` from `types.ts`
- Produces:
  - `parseSmapsRollup(text: string): { pssBytes: number; rssBytes: number }`
  - `parsePpid(statusText: string): number`
  - `readProcessTree(rootPid: number): Promise<RawProcess[]>` (root first, descendants after)

- [ ] **Step 1: Write the failing tests**

Create `test/e2e/utils/memory/process-tree.vitest.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'vitest';
import { parsePpid, parseSmapsRollup } from './process-tree.js';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('real captured procfs output', () => {
	// Task 1 captured these from a running Positron. Inline samples prove the
	// parser handles the shape we think procfs has; these prove it handles the
	// shape it actually has.
	test('parses a real smaps_rollup', () => {
		const { pssBytes, rssBytes } = parseSmapsRollup(fixture('smaps_rollup.txt'));
		expect(pssBytes).toBeGreaterThan(0);
		expect(rssBytes).toBeGreaterThanOrEqual(pssBytes);
	});

	test('parses a real /proc/<pid>/status', () => {
		expect(parsePpid(fixture('proc-status.txt'))).toBeGreaterThan(0);
	});
});

describe('parseSmapsRollup', () => {
	test('reads Pss and Rss and converts kB to bytes', () => {
		const text = [
			'00400000-7fff00000000 ---p 00000000 00:00 0                  [rollup]',
			'Rss:              102400 kB',
			'Pss:               51200 kB',
			'Pss_Dirty:         40000 kB',
			'Shared_Clean:      51200 kB',
		].join('\n');
		expect(parseSmapsRollup(text)).toEqual({ pssBytes: 51200 * 1024, rssBytes: 102400 * 1024 });
	});

	test('does not confuse Pss_Dirty for Pss', () => {
		const text = 'Rss:  100 kB\nPss_Dirty:  999 kB\nPss:  50 kB';
		expect(parseSmapsRollup(text).pssBytes).toBe(50 * 1024);
	});

	test('returns zeroes when the fields are absent rather than throwing', () => {
		expect(parseSmapsRollup('')).toEqual({ pssBytes: 0, rssBytes: 0 });
	});
});

describe('parsePpid', () => {
	test('reads the parent pid', () => {
		const text = 'Name:\tpositron\nUmask:\t0022\nState:\tS (sleeping)\nTgid:\t4242\nPid:\t4242\nPPid:\t1\n';
		expect(parsePpid(text)).toBe(1);
	});

	test('returns 0 when PPid is missing', () => {
		expect(parsePpid('Name:\tpositron\n')).toBe(0);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/e2e/utils/memory/process-tree.vitest.ts`
Expected: FAIL, cannot resolve `./process-tree.js`.

- [ ] **Step 3: Implement the reader**

Create `test/e2e/utils/memory/process-tree.ts`:

```ts
import { promises as fs } from 'fs';
import { RawProcess } from './types.js';

const KB = 1024;

/**
 * Read Pss and Rss out of /proc/<pid>/smaps_rollup. We use Pss as the primary
 * figure because it splits shared pages between the processes mapping them,
 * which makes it safe to sum across a tree. Summing Rss would charge the
 * Electron framework in full to every process that maps it.
 */
export function parseSmapsRollup(text: string): { pssBytes: number; rssBytes: number } {
	const read = (field: string): number => {
		// Anchored so Pss does not also match Pss_Dirty or Pss_Anon.
		const match = text.match(new RegExp(`^${field}:\\s+(\\d+) kB$`, 'm'));
		return match ? parseInt(match[1], 10) * KB : 0;
	};
	return { pssBytes: read('Pss'), rssBytes: read('Rss') };
}

export function parsePpid(statusText: string): number {
	const match = statusText.match(/^PPid:\s+(\d+)$/m);
	return match ? parseInt(match[1], 10) : 0;
}

async function readOrEmpty(path: string): Promise<string> {
	try {
		return await fs.readFile(path, 'utf8');
	} catch {
		// Processes come and go while we walk /proc. A vanished process is
		// normal, not an error.
		return '';
	}
}

/**
 * Walk every descendant of rootPid, returning the root first.
 *
 * Reads all of /proc once and builds the parent map in memory rather than
 * recursing with repeated directory listings, so the snapshot is close to
 * instantaneous and less likely to catch the tree mid-change.
 */
export async function readProcessTree(rootPid: number): Promise<RawProcess[]> {
	const entries = await fs.readdir('/proc');
	const pids = entries.map(e => parseInt(e, 10)).filter(pid => !isNaN(pid));

	const all = new Map<number, RawProcess>();
	for (const pid of pids) {
		const status = await readOrEmpty(`/proc/${pid}/status`);
		if (!status) {
			continue;
		}
		const rawCmd = await readOrEmpty(`/proc/${pid}/cmdline`);
		const { pssBytes, rssBytes } = parseSmapsRollup(await readOrEmpty(`/proc/${pid}/smaps_rollup`));
		all.set(pid, {
			pid,
			ppid: parsePpid(status),
			// /proc/<pid>/cmdline separates arguments with NUL bytes.
			cmd: rawCmd.replace(/\0/g, ' ').trim(),
			pssBytes,
			rssBytes
		});
	}

	const childrenOf = new Map<number, number[]>();
	for (const proc of all.values()) {
		const siblings = childrenOf.get(proc.ppid) ?? [];
		siblings.push(proc.pid);
		childrenOf.set(proc.ppid, siblings);
	}

	const result: RawProcess[] = [];
	const queue = [rootPid];
	const seen = new Set<number>();
	while (queue.length > 0) {
		const pid = queue.shift()!;
		if (seen.has(pid)) {
			continue;
		}
		seen.add(pid);
		const proc = all.get(pid);
		if (proc) {
			result.push(proc);
			queue.push(...(childrenOf.get(pid) ?? []));
		}
	}
	return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/e2e/utils/memory/process-tree.vitest.ts`
Expected: PASS, 7 tests.

`RSS >= PSS` is the assertion worth keeping. It holds for every process by
definition, and it is exactly the invariant that would break if the two fields
were ever transposed.

- [ ] **Step 5: Sanity-check against a real process**

```bash
npx tsx -e "import('./test/e2e/utils/memory/process-tree.js').then(async m => { const t = await m.readProcessTree(process.ppid); console.log(t.length, 'processes', (t.reduce((s,p)=>s+p.pssBytes,0)/1048576).toFixed(1), 'MB PSS'); })"
```

Expected: a non-zero process count and a plausible megabyte figure. If PSS is 0 for everything, `smaps_rollup` is unreadable for that user; run as root or against your own process.

- [ ] **Step 6: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/process-tree.ts test/e2e/utils/memory/process-tree.vitest.ts
git add test/e2e/utils/memory/process-tree.ts test/e2e/utils/memory/process-tree.vitest.ts
git commit -m "test: add procfs process tree reader for memory metrics"
```

---

### Task 4: `--status` name map

**Files:**
- Create: `test/e2e/utils/memory/positron-status.ts`
- Create: `test/e2e/utils/memory/positron-status.vitest.ts`
- Uses: `test/e2e/utils/memory/fixtures/status-linux.txt` from Task 1

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `parseStatusOutput(text: string): Map<number, string>`
  - `resolveCliPath(buildRoot: string): string`
  - `readProcessNames(buildRoot: string, userDataDir: string): Promise<Map<number, string>>`

- [ ] **Step 1: Write the failing tests**

Create `test/e2e/utils/memory/positron-status.vitest.ts`. The inline sample is real captured output with the memory column left exactly as Positron prints it, wrong values and all:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'vitest';
import { parseStatusOutput } from './positron-status.js';

const SAMPLE = [
	'Version:          Positron 2026.08.0+304',
	'Memory (System):  36.00GB (0.10GB free)',
	'',
	'CPU %	Mem MB	   PID	Process',
	'    2	42749012088	  6650	positron',
	'    0	14249670696	  6653	   gpu-process',
	'    0	14249670696	  6654	   utility-network-service',
	'    0	28499341392	  6655	window [1] (Welcome)',
	'    0	14249670696	  6952	shared-process',
	'    0	14249670696	  8367	extension-host [1]',
	'    0	     0	  8404	     /opt/positron/extensions/positron-python/python-env-tools/pet server',
].join('\n');

describe('parseStatusOutput', () => {
	test('maps pids to names and skips the preamble', () => {
		const names = parseStatusOutput(SAMPLE);
		expect(names.get(6650)).toBe('positron');
		expect(names.get(6655)).toBe('window [1] (Welcome)');
		expect(names.get(6952)).toBe('shared-process');
		expect(names.get(8367)).toBe('extension-host [1]');
	});

	test('strips the indentation Positron adds to unnamed children', () => {
		expect(parseStatusOutput(SAMPLE).get(6653)).toBe('gpu-process');
	});

	test('keeps every pid in the table', () => {
		expect(parseStatusOutput(SAMPLE).size).toBe(7);
	});

	test('ignores the memory column entirely', () => {
		// The values above are the real, broken output (issue #15382). Parsing
		// must not depend on them being sane.
		expect(() => parseStatusOutput(SAMPLE)).not.toThrow();
	});

	test('returns an empty map when the table header never appears', () => {
		expect(parseStatusOutput('some unrelated CLI error').size).toBe(0);
	});

	test('parses the captured real output fixture', () => {
		const fixture = readFileSync(join(__dirname, 'fixtures', 'status-linux.txt'), 'utf8');
		const names = parseStatusOutput(fixture);
		expect(names.size).toBeGreaterThan(3);
		expect([...names.values()]).toContain('gpu-process');
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/e2e/utils/memory/positron-status.vitest.ts`
Expected: FAIL, cannot resolve `./positron-status.js`.

- [ ] **Step 3: Implement the parser and the CLI runner**

Create `test/e2e/utils/memory/positron-status.ts`:

```ts
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const TABLE_HEADER = /^CPU %\s+Mem MB\s+PID\s+Process$/;

/**
 * Parse the process table out of `positron --status` into a pid-to-name map.
 *
 * Only the names are taken. The Mem MB column is wrong on Linux and macOS
 * (posit-dev/positron#15382, a double percent-to-bytes conversion) and is never
 * read. Tree structure is not taken either: the indentation is applied only to
 * processes Positron could not name, so it is not a depth signal. Structure
 * comes from procfs PPid instead.
 */
export function parseStatusOutput(text: string): Map<number, string> {
	const names = new Map<number, string>();
	const lines = text.split('\n');
	const headerIndex = lines.findIndex(line => TABLE_HEADER.test(line.trim()));
	if (headerIndex === -1) {
		return names;
	}

	for (const line of lines.slice(headerIndex + 1)) {
		if (line.trim() === '') {
			break;
		}
		// Columns are tab separated: load, memory, pid, name.
		const columns = line.split('\t');
		if (columns.length < 4) {
			continue;
		}
		const pid = parseInt(columns[2].trim(), 10);
		if (isNaN(pid)) {
			continue;
		}
		names.set(pid, columns.slice(3).join('\t').trim());
	}
	return names;
}

/**
 * Find the CLI launcher inside a build. Named after product.json
 * applicationName, but some packagings still ship it as `code`, so try both and
 * fail loudly rather than silently returning a path that does not exist.
 */
export function resolveCliPath(buildRoot: string): string {
	const candidates = [join(buildRoot, 'bin', 'positron'), join(buildRoot, 'bin', 'code')];
	const found = candidates.find(candidate => existsSync(candidate));
	if (!found) {
		throw new Error(`No Positron CLI found. Looked for:\n${candidates.join('\n')}`);
	}
	return found;
}

/**
 * Ask a running Positron to describe its own processes. Returns an empty map on
 * any failure: names are an enrichment, and losing them should downgrade the
 * report to `unlabeled` rows rather than fail the run.
 */
export async function readProcessNames(buildRoot: string, userDataDir: string): Promise<Map<number, string>> {
	try {
		const { stdout } = await execFileAsync(
			resolveCliPath(buildRoot),
			['--user-data-dir', userDataDir, '--status'],
			// env is passed through deliberately: the child Electron main this
			// spawns needs DISPLAY, and without it exits 0 with no output.
			{ timeout: 30_000, maxBuffer: 10 * 1024 * 1024, env: process.env }
		);
		return parseStatusOutput(stdout);
	} catch (error) {
		console.error(`[memory] could not read process names: ${error}`);
		return new Map();
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/e2e/utils/memory/positron-status.vitest.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/positron-status.ts test/e2e/utils/memory/positron-status.vitest.ts
git add test/e2e/utils/memory/positron-status.ts test/e2e/utils/memory/positron-status.vitest.ts
git commit -m "test: parse positron --status into a process name map"
```

---

### Task 5: Snapshot assembly

Settle detection, sampling, and the join. This is the orchestrator.

**Files:**
- Create: `test/e2e/utils/memory/snapshot.ts`
- Create: `test/e2e/utils/memory/snapshot.vitest.ts`

**Interfaces:**
- Consumes: `readProcessTree` (Task 3), `readProcessNames` (Task 4), `resolveRole` (Task 2), types (Task 2)
- Produces:
  - `joinProcesses(raw: RawProcess[], names: Map<number, string>, rootPid: number, samples: RawProcess[][]): LabeledProcess[]`
  - `waitForSettle(rootPid: number, options?: { pollMs?: number; capMs?: number }): Promise<number>`
  - `captureSnapshot(input: { rootPid: number; buildRoot: string; userDataDir: string; launchIndex: number; extensions: ActivatedExtension[] }): Promise<MemorySnapshot>`

- [ ] **Step 1: Write the failing tests for the join**

Create `test/e2e/utils/memory/snapshot.vitest.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { joinProcesses } from './snapshot.js';
import { RawProcess } from './types.js';

const proc = (pid: number, ppid: number, cmd: string, pss: number): RawProcess =>
	({ pid, ppid, cmd, pssBytes: pss, rssBytes: pss * 2 });

describe('joinProcesses', () => {
	const raw = [
		proc(100, 1, '/opt/positron/positron', 90),
		proc(101, 100, 'positron --type=gpu-process', 30),
		proc(102, 100, 'positron --type=utility --utility-sub-type=node.mojom.NodeService', 40),
		proc(103, 102, '/opt/positron/kcserver --log-level debug', 20),
	];
	const names = new Map([[100, 'positron'], [101, 'gpu-process'], [102, 'extension-host [1]']]);

	test('applies Positron names and resolves roles', () => {
		const joined = joinProcesses(raw, names, 100, [raw]);
		expect(joined.find(p => p.pid === 102)?.processRole).toBe('extension_host');
		expect(joined.find(p => p.pid === 101)?.processRole).toBe('gpu');
	});

	test('computes depth from ppid, not from any name indentation', () => {
		const joined = joinProcesses(raw, names, 100, [raw]);
		expect(joined.find(p => p.pid === 100)?.depth).toBe(0);
		expect(joined.find(p => p.pid === 102)?.depth).toBe(1);
		expect(joined.find(p => p.pid === 103)?.depth).toBe(2);
	});

	test('marks a process Positron did not name as unlabeled', () => {
		const joined = joinProcesses(raw, names, 100, [raw]);
		const kernel = joined.find(p => p.pid === 103)!;
		expect(kernel.labeled).toBe(false);
		expect(kernel.processRole).toBe('kernel_supervisor');
	});

	test('takes the median across samples and keeps min and max', () => {
		const samples = [
			[proc(100, 1, '/opt/positron/positron', 80)],
			[proc(100, 1, '/opt/positron/positron', 100)],
			[proc(100, 1, '/opt/positron/positron', 90)],
		];
		const joined = joinProcesses(samples[0], names, 100, samples);
		const main = joined.find(p => p.pid === 100)!;
		expect(main.pssBytes).toBe(90);
		expect(main.pssMin).toBe(80);
		expect(main.pssMax).toBe(100);
	});

	test('a process missing from a later sample still reports from the samples it appears in', () => {
		const samples = [
			[proc(100, 1, 'x', 80), proc(101, 100, 'y', 10)],
			[proc(100, 1, 'x', 80)],
		];
		const joined = joinProcesses(samples[0], names, 100, samples);
		expect(joined.find(p => p.pid === 101)?.pssBytes).toBe(10);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/e2e/utils/memory/snapshot.vitest.ts`
Expected: FAIL, cannot resolve `./snapshot.js`.

- [ ] **Step 3: Implement snapshot assembly**

Create `test/e2e/utils/memory/snapshot.ts`:

```ts
import { basename } from 'path';
import { resolveRole } from './label.js';
import { readProcessNames } from './positron-status.js';
import { readProcessTree } from './process-tree.js';
import { ActivatedExtension, LabeledProcess, MemorySnapshot, RawProcess } from './types.js';

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function depthOf(pid: number, byPid: Map<number, RawProcess>, rootPid: number): number {
	let depth = 0;
	let current = byPid.get(pid);
	while (current && current.pid !== rootPid && depth < 50) {
		current = byPid.get(current.ppid);
		depth++;
	}
	return depth;
}

/**
 * Join one sample's process list with Positron's names, resolve roles, and fold
 * in the per-pid median across all samples.
 */
export function joinProcesses(
	raw: RawProcess[],
	names: Map<number, string>,
	rootPid: number,
	samples: RawProcess[][]
): LabeledProcess[] {
	const byPid = new Map(raw.map(p => [p.pid, p]));

	const pssByPid = new Map<number, number[]>();
	for (const sample of samples) {
		for (const proc of sample) {
			const seen = pssByPid.get(proc.pid) ?? [];
			seen.push(proc.pssBytes);
			pssByPid.set(proc.pid, seen);
		}
	}

	return raw.map(proc => {
		const positronName = names.get(proc.pid);
		const { role, labeled } = resolveRole({
			positronName,
			cmd: proc.cmd,
			isRoot: proc.pid === rootPid
		});
		const observed = pssByPid.get(proc.pid) ?? [proc.pssBytes];
		return {
			pid: proc.pid,
			ppid: proc.ppid,
			depth: depthOf(proc.pid, byPid, rootPid),
			processName: positronName ?? basename(proc.cmd.split(' ')[0] || 'unknown'),
			processRole: role,
			labeled,
			cmdBasename: basename(proc.cmd.split(' ')[0] || 'unknown'),
			pssBytes: median(observed),
			rssBytes: proc.rssBytes,
			pssMin: Math.min(...observed),
			pssMax: Math.max(...observed)
		};
	});
}

const totalPss = (procs: RawProcess[]): number => procs.reduce((sum, p) => sum + p.pssBytes, 0);

/**
 * Wait until the process tree stops growing, rather than sleeping a fixed
 * amount. Returns how long that took, which is worth recording on its own.
 */
export async function waitForSettle(
	rootPid: number,
	options: { pollMs?: number; capMs?: number } = {}
): Promise<number> {
	const pollMs = options.pollMs ?? 1000;
	const capMs = options.capMs ?? 90_000;
	const started = Date.now();
	let previous = 0;
	let stableCount = 0;

	while (Date.now() - started < capMs) {
		const current = totalPss(await readProcessTree(rootPid));
		const changed = previous === 0 ? 1 : Math.abs(current - previous) / previous;
		stableCount = changed < 0.01 ? stableCount + 1 : 0;
		previous = current;
		if (stableCount >= 3) {
			break;
		}
		await new Promise(resolve => setTimeout(resolve, pollMs));
	}
	return Date.now() - started;
}

/** Take three samples five seconds apart once the app has settled. */
export async function captureSnapshot(input: {
	rootPid: number;
	buildRoot: string;
	userDataDir: string;
	launchIndex: number;
	extensions: ActivatedExtension[];
}): Promise<MemorySnapshot> {
	const settleMs = await waitForSettle(input.rootPid);

	const samples: RawProcess[][] = [];
	for (let i = 0; i < 3; i++) {
		if (i > 0) {
			await new Promise(resolve => setTimeout(resolve, 5000));
		}
		samples.push(await readProcessTree(input.rootPid));
	}

	const names = await readProcessNames(input.buildRoot, input.userDataDir);
	const processes = joinProcesses(samples[samples.length - 1], names, input.rootPid, samples);

	return {
		scenario: 'idle',
		launchIndex: input.launchIndex,
		settleMs,
		treeTotalPssBytes: processes.reduce((sum, p) => sum + p.pssBytes, 0),
		processes,
		extensions: input.extensions
	};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/e2e/utils/memory/snapshot.vitest.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/snapshot.ts test/e2e/utils/memory/snapshot.vitest.ts
git add test/e2e/utils/memory/snapshot.ts test/e2e/utils/memory/snapshot.vitest.ts
git commit -m "test: assemble memory snapshots from process tree samples"
```

---

### Task 6: Activated extension inventory

**Executed, and the source changed.** The plan originally scraped the Running
Extensions editor. That editor cannot supply what this task needs:

- Its rows show `marketplaceInfo?.displayName || identifier.value` truncated to 50
  characters (`abstractRuntimeExtensionsEditor.ts:284`). There is no extension id
  anywhere in a row, and the id is the dataset's grouping key.
- There is no `.activation-event` element. The activation event exists only as a
  hover title (line 368), so a locator for it would throw and drop the entire
  inventory into the catch block, returning `[]` on every run without a word.

The extension host log has all of it. `extHostExtensionService.ts:499` logs, at
info level and so present by default:

```
[info] ExtensionService#_doActivateExtension positron.authentication, startup: false, activationEvent: 'onAiEnabled', root cause: positron.next-edit-suggestions
```

A verified launch produced 32 such lines. Parsing that is also unit-testable
against a fixture, which the DOM approach never was.

The one thing only the editor has is per-extension activation times, so
`activationTimeMs` is always null. The design wants the activation *set* ("this
extension newly activates at startup"), not the timings, so this is an acceptable
trade.

**Files:**
- Create: `test/e2e/utils/memory/extensions.ts`
- Create: `test/e2e/utils/memory/extensions.vitest.ts`
- Create: `test/e2e/utils/memory/fixtures/exthost.log`

**Interfaces:**
- Consumes: `ActivatedExtension` from `types.ts`. Notably not the e2e `Application`
  object: this reads files, so it needs no driver and no running window.
- Produces:
  - `parseActivationLog(text: string, userInstalledIds?: Set<string>): ActivatedExtension[]`
  - `readUserInstalledIds(extensionsDir: string): Promise<Set<string>>`
  - `findExtHostLog(logsRoot: string): Promise<string | undefined>`
  - `readActivatedExtensions(input: { logsRoot: string; extensionsDir?: string }): Promise<ActivatedExtension[]>`

- [x] **Step 1: Tests first, then the parser**

Eight tests in `extensions.vitest.ts` cover the id and event, the `root cause`
suffix not leaking into the event, the `*` wildcard event, one entry per id when
activation is logged twice, non-activation lines ignored, empty input, the
builtin split, and the real captured fixture.

- [x] **Step 2: Log location**

Logs are **not** under the user data dir. They live at
`~/.local/state/positron/logs/<timestamp>/window<n>/exthost/exthost.log`, so
Worse, the nesting depth depends on how the app started, and both layouts are
verified against real launches:

| Started | Layout |
| --- | --- |
| `--logsPath=<dir>`, as the e2e harness does | `<dir>/window1/exthost/exthost.log`, and the default location is not written at all |
| no flag | `~/.local/state/positron/logs/<timestamp>/window1/exthost/exthost.log` |

`findExtHostLog` tries the direct layout first, then the newest timestamped session
below the root, then the newest `window*` inside that. Task 9 passes the `logsPath`
Playwright fixture, not `userDataDir` and not the default state dir.

`isBuiltin` is derived by listing the run's extensions dir (directories named
`<publisher>.<name>-<version>`) and treating anything absent from it as shipped
with the build. Against a fresh profile that marks everything builtin, which is
correct rather than a guess. Prefix heuristics on the id would have mislabelled
the bundled non-`vscode.`/`positron.` extensions such as `ms-python.python`,
`posit.assistant`, and `GitHub.copilot-chat`.

- [x] **Step 3: Verified end to end against a real app**

Rather than only checking selectors, `captureSnapshot` was run against a real
launch in the container from Task 1, which exercises Tasks 3 through 6 together:

```
settleMs=3249 processes=16 totalPSS=1170.0MB extensions=32
  extension_host  353.4MB | renderer 285.8MB | main 176.7MB | shared 61.2MB
  gpu 58.7MB | agent_host 58.2MB | unlabeled 55.6MB (n=5) | pty_host 47.3MB
  file_watcher 44.2MB | network 22.5MB | kernel_supervisor 6.4MB (n=2)
named=16/16  unattributed=55.6MB
```

Both of Task 9's quality gates pass with room to spare: every process is named,
and unattributed memory is 4.8% against a one-third budget.

**This run also caught a bug no unit test could.** The first attempt reported
`named=0/16` and 53% unattributed, because `readProcessNames` returned an empty
map: the CLI's child Electron main needs `--no-sandbox` just as the app does, and
without it exits 0 with no output. `readProcessNames` now passes `--no-sandbox`
and logs loudly when the table comes back empty, since silence there quietly
degrades every row to `unlabeled`.

- [x] **Step 4: Commit**

Committed as "test: read activated extension inventory from the extension host
log" and "test: pass --no-sandbox when asking positron to name its processes".

---

### Task 7: Report rendering

**Files:**
- Create: `test/e2e/utils/memory/render.ts`
- Create: `test/e2e/utils/memory/render.vitest.ts`

**Interfaces:**
- Consumes: `MemorySnapshot`, `LabeledProcess` from `types.ts`
- Produces:
  - `renderMarkdown(snapshots: MemorySnapshot[], baseline?: MemorySnapshot): string`
  - `renderHtml(snapshots: MemorySnapshot[], baseline?: MemorySnapshot): string`
  - `formatBytes(bytes: number): string`

- [ ] **Step 1: Write the failing tests**

Create `test/e2e/utils/memory/render.vitest.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { formatBytes, renderHtml, renderMarkdown } from './render.js';
import { LabeledProcess, MemorySnapshot } from './types.js';

const MB = 1024 * 1024;

const process = (overrides: Partial<LabeledProcess> = {}): LabeledProcess => ({
	pid: 100, ppid: 1, depth: 0, processName: 'positron', processRole: 'main',
	labeled: true, cmdBasename: 'positron', pssBytes: 100 * MB, rssBytes: 200 * MB,
	pssMin: 100 * MB, pssMax: 100 * MB, ...overrides
});

const snapshot = (procs: LabeledProcess[], launchIndex = 0): MemorySnapshot => ({
	scenario: 'idle', launchIndex, settleMs: 12_000,
	treeTotalPssBytes: procs.reduce((sum, p) => sum + p.pssBytes, 0),
	processes: procs, extensions: []
});

describe('formatBytes', () => {
	test('renders megabytes with one decimal', () => {
		expect(formatBytes(100 * MB)).toBe('100.0 MB');
	});
	test('renders gigabytes above 1024 MB', () => {
		expect(formatBytes(2048 * MB)).toBe('2.0 GB');
	});
});

describe('renderMarkdown', () => {
	test('reports the total', () => {
		const output = renderMarkdown([snapshot([process()])]);
		expect(output).toContain('100.0 MB');
	});

	test('shows a delta against the baseline', () => {
		const current = snapshot([process({ pssBytes: 150 * MB })]);
		const baseline = snapshot([process({ pssBytes: 100 * MB })]);
		const output = renderMarkdown([current], baseline);
		expect(output).toMatch(/\+50\.0 MB/);
	});

	test('calls out a process that is new since the baseline', () => {
		const current = snapshot([process(), process({ pid: 200, processName: 'duckdb-worker', processRole: 'unlabeled', pssBytes: 100 * MB })]);
		const baseline = snapshot([process()]);
		const output = renderMarkdown([current], baseline);
		expect(output).toContain('duckdb-worker');
		expect(output.toLowerCase()).toContain('new');
	});

	test('flags unlabeled processes so a new one cannot hide', () => {
		const output = renderMarkdown([snapshot([process({ processRole: 'unlabeled', labeled: false, processName: 'mystery' })])]);
		expect(output).toContain('unlabeled');
	});

	test('works with no baseline', () => {
		expect(() => renderMarkdown([snapshot([process()])])).not.toThrow();
	});

	test('aggregates across launches by role', () => {
		const output = renderMarkdown([snapshot([process()], 0), snapshot([process({ pssBytes: 120 * MB })], 1)]);
		// Median of the two launch totals.
		expect(output).toContain('110.0 MB');
	});
});

describe('renderHtml', () => {
	test('produces a self-contained document', () => {
		const output = renderHtml([snapshot([process()])]);
		expect(output).toContain('<!DOCTYPE html>');
		expect(output).toContain('</html>');
	});

	test('indents the tree by depth', () => {
		const output = renderHtml([snapshot([process(), process({ pid: 101, depth: 2, processName: 'kcserver' })])]);
		expect(output).toContain('kcserver');
	});

	test('escapes names so a window title cannot inject markup', () => {
		const output = renderHtml([snapshot([process({ processName: 'window [1] (<script>alert(1)</script>)' })])]);
		expect(output).not.toContain('<script>alert(1)</script>');
		expect(output).toContain('&lt;script&gt;');
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/e2e/utils/memory/render.vitest.ts`
Expected: FAIL, cannot resolve `./render.js`.

- [ ] **Step 3: Implement the renderers**

Create `test/e2e/utils/memory/render.ts`:

```ts
import { LabeledProcess, MemorySnapshot, ProcessRole } from './types.js';

const MB = 1024 * 1024;

export function formatBytes(bytes: number): string {
	const mb = bytes / MB;
	return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function signed(bytes: number): string {
	const sign = bytes >= 0 ? '+' : '-';
	return `${sign}${formatBytes(Math.abs(bytes))}`;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Median total across launches, which is the headline figure. */
function totalAcrossLaunches(snapshots: MemorySnapshot[]): number {
	return median(snapshots.map(s => s.treeTotalPssBytes));
}

function byRole(snapshots: MemorySnapshot[]): Map<ProcessRole, number> {
	const totals = new Map<ProcessRole, number[]>();
	for (const snapshot of snapshots) {
		const perLaunch = new Map<ProcessRole, number>();
		for (const proc of snapshot.processes) {
			perLaunch.set(proc.processRole, (perLaunch.get(proc.processRole) ?? 0) + proc.pssBytes);
		}
		for (const [role, bytes] of perLaunch) {
			totals.set(role, [...(totals.get(role) ?? []), bytes]);
		}
	}
	return new Map([...totals].map(([role, values]) => [role, median(values)]));
}

/** Processes present now that were absent from the baseline, keyed by name. */
function newProcesses(snapshots: MemorySnapshot[], baseline?: MemorySnapshot): LabeledProcess[] {
	if (!baseline) {
		return [];
	}
	const known = new Set(baseline.processes.map(p => p.processName));
	const seen = new Map<string, LabeledProcess>();
	for (const proc of snapshots[0]?.processes ?? []) {
		if (!known.has(proc.processName)) {
			seen.set(proc.processName, proc);
		}
	}
	return [...seen.values()];
}

export function renderMarkdown(snapshots: MemorySnapshot[], baseline?: MemorySnapshot): string {
	const total = totalAcrossLaunches(snapshots);
	const lines: string[] = ['## Memory: idle', ''];

	lines.push(baseline
		? `**Total: ${formatBytes(total)}** (${signed(total - baseline.treeTotalPssBytes)} vs previous nightly)`
		: `**Total: ${formatBytes(total)}**`);
	lines.push('');
	lines.push(`Median of ${snapshots.length} launches. Settle time: ${Math.round(median(snapshots.map(s => s.settleMs)) / 1000)}s.`);
	lines.push('');

	const baselineRoles = baseline ? byRole([baseline]) : new Map<ProcessRole, number>();
	lines.push('| Role | PSS | Change |', '| --- | --- | --- |');
	for (const [role, bytes] of [...byRole(snapshots)].sort((a, b) => b[1] - a[1])) {
		const before = baselineRoles.get(role);
		const change = baseline ? (before === undefined ? 'new' : signed(bytes - before)) : '';
		lines.push(`| \`${role}\` | ${formatBytes(bytes)} | ${change} |`);
	}
	lines.push('');

	const appeared = newProcesses(snapshots, baseline);
	if (appeared.length > 0) {
		lines.push('### New processes since the last nightly', '');
		for (const proc of appeared) {
			lines.push(`- \`${proc.processName}\` (${proc.processRole}) ${formatBytes(proc.pssBytes)}`);
		}
		lines.push('');
	}

	const unlabeled = (snapshots[0]?.processes ?? []).filter(p => p.processRole === 'unlabeled');
	if (unlabeled.length > 0) {
		const bytes = unlabeled.reduce((sum, p) => sum + p.pssBytes, 0);
		lines.push(`> ${unlabeled.length} unlabeled process(es) totalling ${formatBytes(bytes)}. Add them to the role map in \`test/e2e/utils/memory/label.ts\`.`, '');
	}

	return lines.join('\n');
}

export function renderHtml(snapshots: MemorySnapshot[], baseline?: MemorySnapshot): string {
	const rows = (snapshots[0]?.processes ?? [])
		.sort((a, b) => b.pssBytes - a.pssBytes)
		.map(proc => `<tr>
			<td style="padding-left:${proc.depth * 20}px">${escapeHtml(proc.processName)}</td>
			<td><code>${escapeHtml(proc.processRole)}</code></td>
			<td align="right">${formatBytes(proc.pssBytes)}</td>
			<td align="right">${formatBytes(proc.rssBytes)}</td>
			<td align="right">${proc.pid}</td>
		</tr>`).join('\n');

	const extensions = (snapshots[0]?.extensions ?? [])
		.map(ext => `<li><code>${escapeHtml(ext.extensionId)}</code>${ext.activationTimeMs === null ? '' : ` (${ext.activationTimeMs} ms)`}</li>`)
		.join('\n');

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Positron memory: idle</title>
	<style>
		body { font-family: system-ui, sans-serif; margin: 2rem; }
		table { border-collapse: collapse; width: 100%; }
		td, th { border-bottom: 1px solid #ddd; padding: 4px 8px; }
	</style>
</head>
<body>
	<h1>Positron memory: idle</h1>
	<p>Total PSS: <strong>${formatBytes(totalAcrossLaunches(snapshots))}</strong>${baseline ? ` (${signed(totalAcrossLaunches(snapshots) - baseline.treeTotalPssBytes)} vs previous nightly)` : ''}</p>
	<h2>Process tree</h2>
	<table>
		<tr><th align="left">Process</th><th align="left">Role</th><th align="right">PSS</th><th align="right">RSS</th><th align="right">PID</th></tr>
		${rows}
	</table>
	<h2>Activated extensions (${(snapshots[0]?.extensions ?? []).length})</h2>
	<ul>
${extensions}
	</ul>
</body>
</html>`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/e2e/utils/memory/render.vitest.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/render.ts test/e2e/utils/memory/render.vitest.ts
git add test/e2e/utils/memory/render.ts test/e2e/utils/memory/render.vitest.ts
git commit -m "test: render memory snapshots to markdown and html"
```

---

### Task 8: Publishing

**Files:**
- Create: `test/e2e/utils/memory/publish.ts`
- Create: `test/e2e/utils/memory/publish.vitest.ts`

**Interfaces:**
- Consumes: `MemorySnapshot` from `types.ts`, and `CONNECT_API_KEY`, `PROD_API_URL`,
  `LOCAL_API_URL`, `platformOs`, `platformVersion`, `positronVersion` from
  `test/e2e/utils/metrics/metric-base.ts`
- Produces:
  - `type MemoryPayload` (the contract the dashboard plan implements)
  - `type BaselineResponse`
  - `buildPayload(snapshots: MemorySnapshot[], meta: RunMeta): MemoryPayload`
  - `redactProcessName(name: string): string`
  - `baselineToSnapshot(body: BaselineResponse): MemorySnapshot | undefined`
  - `publishSnapshots(snapshots: MemorySnapshot[], meta: RunMeta): Promise<boolean>`
  - `fetchBaseline(): Promise<MemorySnapshot | undefined>`

**Three changes made while executing:**

- **The URLs are derived, not restated.** `metric-base.ts` already owns the host and
  the PROD/LOCAL split, so the memory endpoints come from
  `PROD_API_URL.replace(/\/metrics$/, '/memory')`. Hard-coding the host a second time
  means a future host change fixes metrics and leaves memory posting into the void.
- **`platform_version` was wrong.** The draft set it to `process.platform`, which is
  the platform *name* (`'linux'`) and a duplicate of `platform_os`. It now uses
  `platformVersion` (`os.release()`), the kernel release, which is what actually
  distinguishes two container images running the same OS. A test asserts the two
  fields differ.
- **`baselineToSnapshot` was split out** of `fetchBaseline` so the response mapping
  is testable without a live endpoint.

The payload is a cross-repo contract, so it gets unit tests rather than only a
compile check: 12 tests covering the version pin, run metadata, snake_case
conversion of every process field, title redaction, the extension inventory,
platform fields, and both baseline branches.

Note for anyone running these tests: importing `metric-base.ts` pulls in the whole
e2e infra, and something in that chain imports `@playwright/test`, which tries to
reach `localhost:3000` when loaded outside the Playwright runner. The resulting
`ECONNREFUSED` noise predates this work, is unrelated to it, and does not fail the
run.

- [x] **Step 1: Implement the client, tests alongside**

Create `test/e2e/utils/memory/publish.ts`. It follows the existing conventions in `test/e2e/utils/metrics/api.ts`: same auth header, same PROD/LOCAL branch gate, same fail-soft behaviour.

```ts
import { request } from 'undici';
import { getPositronVersion } from '../../infra/test-runner/test-setup.js';
import { MemorySnapshot } from './types.js';

const CONNECT_API_KEY = process.env.CONNECT_API_KEY!;
const PROD_API_URL = 'https://connect.posit.it/e2e-test-insights-api/memory';
const LOCAL_API_URL = 'http://127.0.0.1:8000/memory';

export type RunMeta = {
	runId: string;
	commitSha: string;
	branch: string;
	containerImage: string;
};

/**
 * One request per run, carrying every launch. The existing /metrics endpoint
 * takes a row per request, which for memory would let a partially written tree
 * surface as a fake memory drop.
 */
export type MemoryPayload = {
	/**
	 * Wire format version. Bump when a field changes meaning or disappears, so
	 * ingestion can reject or migrate rather than silently mis-parse. The
	 * dashboard plan is written against version 1.
	 */
	payload_version: 1;
	timestamp: string;
	run_id: string;
	branch: string;
	commit_sha: string;
	app_version: string;
	build_number: string;
	platform_os: string;
	platform_version: string;
	container_image: string;
	scenario: 'idle';
	launches: {
		launch_index: number;
		settle_ms: number;
		tree_total_pss_bytes: number;
		processes: {
			pid: number;
			ppid: number;
			depth: number;
			process_name: string;
			process_role: string;
			labeled: boolean;
			cmd_basename: string;
			pss_bytes: number;
			rss_bytes: number;
			pss_min: number;
			pss_max: number;
		}[];
		extensions: {
			extension_id: string;
			is_builtin: boolean;
			activation_time_ms: number | null;
			activation_event: string | null;
		}[];
	}[];
};

function apiUrl(branch: string): string {
	return branch === 'main' ? PROD_API_URL : LOCAL_API_URL;
}

/**
 * Drop the window title from a process name before publishing.
 *
 * `window [1] (my-project)` carries the workspace name, and in a manually
 * dispatched run that can be anything on the contributor's disk. The title adds
 * nothing to a grouped chart, so the published name keeps only the stable part.
 * The local HTML report still renders the full name.
 */
export function redactProcessName(name: string): string {
	return name.replace(/^(window \[\d+\]).*$/, '$1');
}

export function buildPayload(snapshots: MemorySnapshot[], meta: RunMeta): MemoryPayload {
	const version = getPositronVersion();
	return {
		payload_version: 1,
		timestamp: new Date().toISOString(),
		run_id: meta.runId,
		branch: meta.branch,
		commit_sha: meta.commitSha,
		app_version: version?.positronVersion ?? 'unknown',
		build_number: String(version?.buildNumber ?? 'unknown'),
		platform_os: 'Linux',
		platform_version: process.platform,
		container_image: meta.containerImage,
		scenario: 'idle',
		launches: snapshots.map(snapshot => ({
			launch_index: snapshot.launchIndex,
			settle_ms: snapshot.settleMs,
			tree_total_pss_bytes: snapshot.treeTotalPssBytes,
			processes: snapshot.processes.map(p => ({
				pid: p.pid, ppid: p.ppid, depth: p.depth,
				process_name: redactProcessName(p.processName), process_role: p.processRole,
				labeled: p.labeled, cmd_basename: p.cmdBasename,
				pss_bytes: p.pssBytes, rss_bytes: p.rssBytes,
				pss_min: p.pssMin, pss_max: p.pssMax
			})),
			extensions: snapshot.extensions.map(e => ({
				extension_id: e.extensionId,
				is_builtin: e.isBuiltin,
				activation_time_ms: e.activationTimeMs,
				activation_event: e.activationEvent
			}))
		}))
	};
}

/** Returns whether the publish succeeded. Never throws: reports are the point. */
export async function publishSnapshots(snapshots: MemorySnapshot[], meta: RunMeta): Promise<boolean> {
	if (!CONNECT_API_KEY) {
		console.log('[memory] no CONNECT_API_KEY, skipping publish');
		return false;
	}
	try {
		const response = await request(apiUrl(meta.branch), {
			method: 'POST',
			headers: { Authorization: `Key ${CONNECT_API_KEY}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(buildPayload(snapshots, meta))
		});
		console.log(`[memory] publish responded ${response.statusCode}`);
		return response.statusCode < 400;
	} catch (error) {
		console.error(`[memory] publish failed: ${error}`);
		return false;
	}
}

/**
 * Response shape for `GET /memory/baseline`. This is a contract with the
 * dashboard plan, not an inference from whatever it happens to return.
 *
 *   GET /memory/baseline?scenario=idle&branch=main
 *   Authorization: Key <CONNECT_API_KEY>
 *
 * 200 with `{ "found": false }` when no baseline exists yet. That is a normal
 * first-run state, not an error, and must not be a 404: a 404 is
 * indistinguishable from a typo in the path.
 *
 * 200 with `{ "found": true, "snapshot": {...} }` otherwise, where `snapshot`
 * carries the median launch of the most recent main-branch nightly, using the
 * same field names as one entry of `MemoryPayload.launches` plus the run-level
 * `tree_total_pss_bytes`.
 */
export type BaselineResponse =
	| { found: false }
	| {
		found: true;
		snapshot: {
			tree_total_pss_bytes: number;
			settle_ms: number;
			processes: { process_name: string; process_role: string; pss_bytes: number }[];
			extensions: { extension_id: string }[];
		};
	};

/**
 * Most recent main-branch nightly, used for the delta in the run report.
 * Undefined when there is no baseline yet or the endpoint is unavailable, in
 * which case the report shows absolute numbers only.
 */
export async function fetchBaseline(): Promise<MemorySnapshot | undefined> {
	if (!CONNECT_API_KEY) {
		return undefined;
	}
	try {
		const response = await request(`${PROD_API_URL}/baseline?scenario=idle&branch=main`, {
			method: 'GET',
			headers: { Authorization: `Key ${CONNECT_API_KEY}` }
		});
		if (response.statusCode >= 400) {
			return undefined;
		}
		const body = await response.body.json() as BaselineResponse;
		if (!body.found) {
			return undefined;
		}
		return {
			scenario: 'idle',
			launchIndex: 0,
			settleMs: body.snapshot.settle_ms,
			treeTotalPssBytes: body.snapshot.tree_total_pss_bytes,
			// Only the fields the report's delta actually reads are mapped. The
			// rest are filled with neutral values rather than faked.
			processes: body.snapshot.processes.map(p => ({
				pid: 0, ppid: 0, depth: 0,
				processName: p.process_name,
				processRole: p.process_role as MemorySnapshot['processes'][number]['processRole'],
				labeled: true, cmdBasename: '',
				pssBytes: p.pss_bytes, rssBytes: 0, pssMin: p.pss_bytes, pssMax: p.pss_bytes
			})),
			extensions: body.snapshot.extensions.map(e => ({
				extensionId: e.extension_id, isBuiltin: false,
				activationTimeMs: null, activationEvent: null
			}))
		};
	} catch (error) {
		console.error(`[memory] could not fetch baseline: ${error}`);
		return undefined;
	}
}
```

- [x] **Step 2: Verify it compiles and fails soft**

```bash
npm run test:positron:check-ts 2>&1 | grep 'memory/' || echo "no type errors"
```

Expected: no type errors. With no `CONNECT_API_KEY` set, both functions must return without throwing; this is exercised by Task 9 running locally.

- [ ] **Step 3: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/publish.ts
git add test/e2e/utils/memory/publish.ts
git commit -m "test: publish memory snapshots to the insights API"
```

---

### Task 9: The e2e spec

**Files:**
- Create: `test/e2e/tests/performance/memory-idle.test.ts`
- Create: `test/e2e/fixtures/settingsMemory.json`
- Modify: `test/e2e/fixtures/test-setup/shared-utils.ts` (in `copyUserSettings`, after the skip-pyrefly merge at line 66-76)

**Interfaces:**
- Consumes: everything from Tasks 2 through 8
- Produces: `memory-snapshot.json`, `memory-report.html` in the run's output directory, and a step summary appended to `GITHUB_STEP_SUMMARY`

- [x] **Step 1: Check the fixtures and tags available**

```bash
grep -n "PERFORMANCE\|WIN =" test/e2e/infra/test-runner/test-tags.ts | head
grep -n "suiteId" test/e2e/tests/notebooks-positron/performance/kernel-startup.test.ts
```

Reuse `tags.PERFORMANCE`. Do not add a new tag; this spec is not selected by tag in PR runs.

- [x] **Step 2: Add the pre-launch settings override**

The scenario is only meaningful if idle means idle. A runtime auto-starting would add both its own memory and a large amount of variance, and it belongs to a later scenario.

This has to be applied **before** the app launches. Setting it mid-session would leave the auto-started runtime already running and already counted.

Create `test/e2e/fixtures/settingsMemory.json`:

```json
{
	"interpreters.startupBehavior": "manual"
}
```

Then merge it conditionally in `copyUserSettings` in `test/e2e/fixtures/test-setup/shared-utils.ts`, directly after the existing skip-pyrefly block. This mirrors the `ALLOW_PYREFLY` pattern already there, so the override is opt-in and cannot affect any other suite:

```ts
	// 3. Merge memory-scenario settings so the idle memory spec measures a
	// genuinely idle app. Must be pre-launch: starting a runtime and then
	// disabling it would leave it running and counted.
	if (process.env.MEMORY_SCENARIO === 'idle') {
		const memorySettingsFile = path.join(fixturesDir, 'settingsMemory.json');
		if (fs.existsSync(memorySettingsFile)) {
			const memorySettings = JSON.parse(fs.readFileSync(memorySettingsFile, 'utf8'));
			mergedSettings = {
				...mergedSettings,
				...memorySettings,
			};
		}
	}
```

`MEMORY_SCENARIO=idle` is set on every measure step in Task 11.

- [x] **Step 3: Verify the override actually lands**

```bash
MEMORY_SCENARIO=idle BUILD=/path/to/positron-build npx playwright test test/e2e/tests/performance/memory-idle.test.ts --project e2e-electron --grep 'Idle memory footprint' 2>&1 | head -5
grep -r "startupBehavior" /tmp/positron-*/User/settings.json 2>/dev/null | head -2
```

Expected: the setting appears in the launched instance's `settings.json`. If it does not, the merge is in the wrong place or the env var is not reaching the fixture, and every subsequent number would silently include an auto-started runtime.

Verified on macOS against the downloaded 2026.08.0-331 build: the launched
instance's settings file carried `"interpreters.startupBehavior": "manual"`
alongside the existing skip-pyrefly keys, so the merge lands and does not clobber
what was already there. The user data dir is under
`$TMPDIR/vscsmoke/d-<random>/User/settings.json`, not `/tmp/positron-*`.

- [x] **Step 4: Write the spec**

Create `test/e2e/tests/performance/memory-idle.test.ts`:

```ts
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { expect, tags, test } from '../_test.setup';
import { readActivatedExtensions } from '../../utils/memory/extensions.js';
import { fetchBaseline, publishSnapshots } from '../../utils/memory/publish.js';
import { renderHtml, renderMarkdown } from '../../utils/memory/render.js';
import { captureSnapshot } from '../../utils/memory/snapshot.js';
import { MemorySnapshot } from '../../utils/memory/types.js';

test.use({
	suiteId: __filename
});

/**
 * Snapshots must outlive a single Playwright invocation: three separate
 * `npx playwright test` runs write here and a fourth reads them back.
 *
 * Deliberately NOT under `test-results/`. Playwright's outputDir defaults to
 * `test-results` and is wiped at the start of every run, so launch 1 would
 * delete launch 0's snapshot and the aggregation run would delete all three.
 * RUNNER_TEMP persists for the whole job.
 */
const SNAPSHOT_DIR = join(process.env.RUNNER_TEMP ?? '/tmp', 'memory-snapshots');

test.describe('Memory: idle', { tag: [tags.PERFORMANCE] }, () => {

	test('Idle memory footprint of the Positron process tree', async function ({ app, logsPath }) {
		const buildRoot = process.env.BUILD;
		expect(buildRoot, 'BUILD must point at a Positron build; memory numbers from a dev build are meaningless').toBeTruthy();

		const mainPid = app.code.electronApp?.process().pid;
		expect(mainPid, 'no Electron main pid; this spec only runs against Electron').toBeTruthy();

		// The harness passes --logsPath, so take the root from that same fixture
		// rather than the default state dir. See Task 6.
		const extensions = await readActivatedExtensions({
			logsRoot: logsPath,
			extensionsDir: app.extensionsPath
		});

		const snapshot = await captureSnapshot({
			rootPid: mainPid!,
			buildRoot: buildRoot!,
			userDataDir: app.userDataPath,
			launchIndex: Number(process.env.MEMORY_LAUNCH_INDEX ?? 0),
			extensions
		});

		// A tree that reports nothing means the procfs read failed, which would
		// otherwise publish a convincing-looking zero.
		expect(snapshot.processes.length, 'no processes found in the tree').toBeGreaterThan(3);
		expect(snapshot.treeTotalPssBytes, 'total PSS was zero; smaps_rollup is probably unreadable').toBeGreaterThan(0);

		// Quality gate. Every component here fails soft, which is right for a
		// report but wrong for a baseline: if `--status` silently returns
		// nothing, we would publish a plausible-looking total built entirely
		// from guesses. Refuse to record data we cannot attribute.
		const namedShare = snapshot.processes.filter(p => p.labeled).length / snapshot.processes.length;
		expect(namedShare, 'Positron named too few processes; --status probably failed, and an unattributable total is worse than no data').toBeGreaterThan(0.5);

		const unlabeledBytes = snapshot.processes
			.filter(p => p.processRole === 'unlabeled')
			.reduce((sum, p) => sum + p.pssBytes, 0);
		expect(unlabeledBytes / snapshot.treeTotalPssBytes, 'more than a third of memory is unattributed; add rules to label.ts').toBeLessThan(0.34);

		// Extensions activate in every normal run (a verified launch logged 32),
		// so an empty inventory means the log was not found rather than that
		// nothing activated.
		expect(snapshot.extensions.length, 'no activated extensions found; findExtHostLog probably looked in the wrong logsRoot').toBeGreaterThan(0);

		mkdirSync(SNAPSHOT_DIR, { recursive: true });
		writeFileSync(join(SNAPSHOT_DIR, `memory-snapshot-${snapshot.launchIndex}.json`), JSON.stringify(snapshot, null, 2));

		console.log(`[memory] launch ${snapshot.launchIndex}: ${(snapshot.treeTotalPssBytes / 1048576).toFixed(1)} MB PSS across ${snapshot.processes.length} processes, settled in ${snapshot.settleMs} ms`);
	});
});

/**
 * Aggregation runs after all launches. Reads whatever snapshot files exist,
 * renders the report, and publishes.
 *
 * Kept separate from the measuring test so a failure to render or publish
 * cannot lose the measurement, which is the expensive part.
 */
test.describe('Memory: report', { tag: [tags.PERFORMANCE] }, () => {

	test('Render and publish the idle memory report', async function () {
		test.skip(process.env.MEMORY_AGGREGATE !== 'true', 'only runs in the aggregation step');

		const snapshots: MemorySnapshot[] = [];
		for (let i = 0; i < 3; i++) {
			snapshots.push(JSON.parse(readFileSync(join(SNAPSHOT_DIR, `memory-snapshot-${i}.json`), 'utf8')));
		}

		// Require all three. Reporting a "median" over one surviving launch
		// would look identical to a healthy run while telling us nothing about
		// variance, which is the whole reason we launch three times.
		expect(snapshots.length, `expected 3 snapshots in ${SNAPSHOT_DIR}`).toBe(3);

		const baseline = await fetchBaseline();
		const markdown = renderMarkdown(snapshots, baseline);
		const html = renderHtml(snapshots, baseline);

		mkdirSync(SNAPSHOT_DIR, { recursive: true });
		writeFileSync(join(SNAPSHOT_DIR, 'memory-report.html'), html);
		if (process.env.GITHUB_STEP_SUMMARY) {
			appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
		}
		console.log(markdown);

		await publishSnapshots(snapshots, {
			runId: process.env.GITHUB_RUN_ID ?? 'local',
			commitSha: process.env.GITHUB_SHA ?? 'unknown',
			branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'local',
			containerImage: process.env.MEMORY_CONTAINER_IMAGE ?? 'unknown'
		});
	});
});
```

- [ ] **Step 5: Run it locally against a build** (partially done: see below)

```bash
unset BUILD
export BUILD=/path/to/positron-build
MEMORY_SCENARIO=idle npx playwright test test/e2e/tests/performance/memory-idle.test.ts --project e2e-electron --grep 'Idle memory footprint'
```

Expected: passes, and logs a plausible total (roughly 400 MB to 1.5 GB) across more than three processes. Check `${RUNNER_TEMP:-/tmp}/memory-snapshots/memory-snapshot-0.json` and confirm the roles look sensible and that few processes are `unlabeled`.

If many processes are `unlabeled`, that is the signal to add rules to `label.ts` (and tests for them in `label.vitest.ts`) before moving on.

**Still outstanding, and it needs Linux.** Run on macOS the spec gets all the way
through app launch, the extension inventory, and into `captureSnapshot` before
failing at `readdir('/proc')`, which confirms the Playwright wiring (fixtures,
`app.code.electronApp.process().pid`, `logsPath`, `BUILD`) and nothing about the
measurement. The measurement chain itself is separately verified on Linux (see
Task 6 Step 3), but not yet *through Playwright*, which needs Linux-native
`node_modules`: either the ci-arm lab container or the nightly workflow from
Task 11 running for real.

- [x] **Step 6: Run the aggregation path**

```bash
MEMORY_AGGREGATE=true npx playwright test test/e2e/tests/performance/memory-idle.test.ts --project e2e-electron --grep 'Render and publish'
```

Expected: prints the markdown report, writes `${RUNNER_TEMP:-/tmp}/memory-snapshots/memory-report.html`, and logs that publishing was skipped for want of an API key. Open the HTML and confirm the tree reads correctly.

Verified, using three real snapshots captured from the Linux container so the
report was exercised against real shapes and real variance (1159 / 1075 / 1067 MB
across launches):

```
**Total: 1.0 GB**            Median of 3 launches. Settle time: 3s.
extension_host 340.0 MB | renderer 241.8 MB | main 162.7 MB | shared 60.5 MB
agent_host 57.2 MB | unlabeled 52.8 MB | gpu 50.1 MB | pty_host 47.3 MB
file_watcher 42.5 MB | network 17.0 MB | kernel_supervisor 6.5 MB
[memory] no CONNECT_API_KEY, skipping publish
```

Note that the report test still launches an app it does not use, because the `app`
fixture is `auto: true`. That costs about a minute and is not worth fighting.

**This run found a real defect in Task 7's renderer**, which only multi-launch data
could expose: the role table reported medians across launches while the unlabeled
note summed launch 0, so the same quantity appeared as 52.8 MB in the table and
55.5 MB in the note directly below it. Both now read from the median, with a
regression test that fails against the old code.

- [x] **Step 7: Commit**

```bash
npm run precommit -- test/e2e/tests/performance/memory-idle.test.ts test/e2e/fixtures/settingsMemory.json test/e2e/fixtures/test-setup/shared-utils.ts
git add test/e2e/tests/performance/memory-idle.test.ts test/e2e/fixtures/settingsMemory.json test/e2e/fixtures/test-setup/shared-utils.ts
git commit -m "test: add idle memory footprint e2e spec"
```

---

### Task 10: Linux build acquisition

`download-build.sh` only handles macOS. Line 51 builds the asset name as
`Positron-darwin-${VERSION}-${ARCH}.zip` and line 82 searches the extraction for
`Positron.app`. On Ubuntu it fails before any test runs.

The release does publish what we need: `Positron-linux-<version>-x64.tar.gz` is
in every `posit-dev/positron-builds` release. Nothing consumes it yet, because
the Ubuntu e2e lane builds from source rather than downloading.

**Files:**
- Modify: `.github/scripts/release-screenshots/download-build.sh`

**Interfaces:**
- Consumes: nothing
- Produces: `BUILD=/path/to/build-root` on stdout for Linux as well as macOS. On Linux the build root is the directory containing the `positron` executable, which is what `getBuildElectronPath` (`test/e2e/infra/electron.ts:180`) expects.

- [ ] **Step 1: Confirm the tarball layout**

Do not assume it. Download one and look:

```bash
VERSION=$(gh api "repos/posit-dev/positron-builds/releases?per_page=100" --jq '[.[] | select(.prerelease == true)] | .[0].tag_name')
gh release download "$VERSION" --repo posit-dev/positron-builds --pattern "Positron-linux-${VERSION}-x64.tar.gz" --dir /tmp/pbuild
tar tzf "/tmp/pbuild/Positron-linux-${VERSION}-x64.tar.gz" | head -20
```

Confirmed on 2026-08-06 against `2026.08.0-331`: the tarball extracts **flat** (`./positron`, `./bin/positron`, `./resources/app/`), not into a single top-level directory. That is why the script below extracts into a directory of its own rather than unpacking alongside the archive, and why it checks for the executable directly instead of searching for it. A `find`-based lookup would match both `./positron` and `./bin/positron` and pick arbitrarily.

Also confirmed: `resources/app/product.json` has `applicationName` = `positron`, so `getBuildElectronPath` resolves the executable as `join(root, 'positron')`, matching what this script prints.

- [ ] **Step 2: Generalize the script**

Replace the platform-specific portion of `.github/scripts/release-screenshots/download-build.sh`. Keep the macOS path byte-identical so the existing release-screenshots workflow is unaffected.

Update the header comment (lines 2-5) to say it prints a build path for macOS or Linux, then replace the `ASSET=` assignment on line 51 and the extraction block on lines 81-88 with:

```bash
resolve_os() {
	case "$(uname -s)" in
		Darwin) echo "darwin" ;;
		Linux)  echo "linux"  ;;
		*) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
	esac
}

OS=$(resolve_os)
if [[ "$OS" == "darwin" ]]; then
	ASSET="Positron-darwin-${VERSION}-${ARCH}.zip"
else
	ASSET="Positron-linux-${VERSION}-${ARCH}.tar.gz"
fi
```

and, after the download loop:

```bash
if [[ "$OS" == "darwin" ]]; then
	unzip -q "$WORKDIR/$ASSET" -d "$WORKDIR"
	BUILD_PATH=$(find "$WORKDIR" -maxdepth 2 -name 'Positron.app' -type d | head -n1)
else
	tar -xzf "$WORKDIR/$ASSET" -C "$WORKDIR"
	# The build root is whichever extracted directory holds the executable.
	# Found rather than hard-coded, because the top-level directory name has
	# changed across packaging revisions.
	BUILD_PATH=$(dirname "$(find "$WORKDIR" -maxdepth 3 -name 'positron' -type f -perm -u+x | head -n1)")
fi

if [[ -z "$BUILD_PATH" || ! -e "$BUILD_PATH" ]]; then
	echo "Build root not found after extracting $ASSET" >&2
	exit 1
fi

echo "BUILD=$BUILD_PATH"
```

- [ ] **Step 3: Verify both platforms still resolve**

On Linux (or in the container):

```bash
.github/scripts/release-screenshots/download-build.sh latest-prerelease
```

Expected: prints `BUILD=/path/to/extracted/root`, and that directory contains both `positron` and `bin/`. Confirm the CLI Task 4 needs is present:

```bash
BUILD_PATH=$(.github/scripts/release-screenshots/download-build.sh latest-prerelease | grep -oP '(?<=^BUILD=).*')
ls "$BUILD_PATH/positron" "$BUILD_PATH/bin/"
```

This also settles the open question from Task 1 Step 2 about whether the CLI is named `positron` or `code`.

On macOS, confirm the existing behaviour is unchanged:

```bash
.github/scripts/release-screenshots/download-build.sh latest-prerelease
```

Expected: still prints a path ending in `Positron.app`.

- [ ] **Step 4: Commit**

```bash
npm run precommit -- .github/scripts/release-screenshots/download-build.sh
git add .github/scripts/release-screenshots/download-build.sh
git commit -m "ci: support linux builds in download-build.sh"
```

---

### Task 11: Nightly workflow

**Files:**
- Create: `.github/workflows/test-memory-metrics.yml`

**Interfaces:**
- Consumes: the spec from Task 9, the Linux build path from Task 10
- Produces: nightly runs, a step summary, and an uploaded HTML artifact

- [x] **Step 1: Read the workflow being modelled**

```bash
sed -n '1,60p' .github/workflows/release-screenshots.yml
sed -n '90,140p' .github/workflows/test-e2e-ubuntu-run.yml
```

Note how `release-screenshots.yml` resolves a version and calls `download-build.sh`, and how `test-e2e-ubuntu-run.yml` declares the container and runner. Reuse both patterns rather than inventing new ones.

- [x] **Step 2: Write the workflow**

**The draft in this plan was missing five things the harness actually requires.**
Every one of them fails the whole run, and none is visible without reading the
working lanes, so the shipped workflow differs from the YAML below:

| Missing | Why the run fails without it |
| --- | --- |
| `POSITRON_PY_VER_SEL`, `POSITRON_R_VER_SEL`, and both `_ALT_` variants | The `envVars` fixture in `_test.setup.ts` is `auto: true` and calls `validateEnvironmentVars(..., { allowEmpty: false })`. Unset means *every* test fails at setup. No interpreter is installed or started; the values only have to be present. |
| `./.github/actions/setup-xvfb` | Exports `DISPLAY=:10`. Without it the app has no display, and `positron --status` silently returns nothing, so every process is `unlabeled` and the attribution gate fails. |
| `./.github/actions/setup-e2e-test-dependencies` instead of `npm ci` | The Ubuntu lane never runs `npm ci`; it extracts a prebuilt repo including `node_modules`. This action installs just the Playwright and e2e deps and compiles `test/e2e`, which is all a downloaded build needs. |
| An explicit `undici` install | `publish.ts` imports it, the action above does not install it, and it currently resolves only as a transitive dep of the reporters. The range is captured before that action replaces the root `package.json` with a stub, so it cannot drift. |
| `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` | Copied from the lanes; Playwright needs it on these runners. |

Also changed: `ENABLE_CUSTOM_REPORTER: 'false'`, so memory runs do not land in the e2e
results dataset as ordinary test runs (and the job needs no AWS credentials);
`actions/checkout@v7` and `actions/upload-artifact@v7`, which is what the rest of the
repo uses (the plan's `@v4` was stale); and a `concurrency` group, since the job holds
an 8x runner for three cold launches.

**Temporary `pull_request` trigger.** The workflow is nightly by design, but nothing
about it can be verified locally, so it is also scoped to pull requests touching the
collector so it can be proven before merging. Marked with a `TEMPORARY, remove before
merging` comment at the trigger.

Known limitation, not fixed here: `latest-prerelease` resolution goes through
`download-build.sh`, whose `.[0]`-of-prereleases logic can pick a mirrored stable build,
where `release-screenshots.yml` has more careful resolution that excludes stable tags.
For a memory *trend* that means an occasional run measuring different code. Worth
sharing that resolution between the two callers later.

Create `.github/workflows/test-memory-metrics.yml`:

```yaml
name: "Test: Memory Metrics"

on:
  schedule:
    - cron: '0 7 * * *' # 07:00 UTC, avoiding the 02:00 and 09:00 scheduled jobs
  workflow_dispatch:
    inputs:
      version:
        description: "Positron version: a tag, 'latest-prerelease', or 'latest-release'"
        required: false
        default: "latest-prerelease"

env:
  MEMORY_CONTAINER_IMAGE: ghcr.io/posit-dev/positron-ubuntu24:24.15.0

jobs:
  memory:
    name: Idle memory footprint
    runs-on: ubuntu-latest-8x
    timeout-minutes: 45
    container:
      image: ghcr.io/posit-dev/positron-ubuntu24:24.15.0
      # The image is private, so the pull needs credentials. Copied from
      # test-e2e-ubuntu-run.yml; without these the job fails before any step.
      # --user 0:0 also matters here beyond convention: reading
      # /proc/<pid>/smaps_rollup for another process requires matching uid or
      # CAP_SYS_PTRACE.
      options: --user 0:0 --init
      credentials:
        username: ${{ secrets.POSITRON_GITHUB_RO_USER }}
        password: ${{ secrets.POSITRON_GITHUB_RO_PAT }}
    steps:
      - uses: actions/checkout@v4

      - name: Download build
        id: build
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          OUTPUT=$(.github/scripts/release-screenshots/download-build.sh "${{ inputs.version || 'latest-prerelease' }}")
          echo "$OUTPUT" >> "$GITHUB_OUTPUT"

      - name: Install dependencies
        run: npm ci

      # Three launches, because launch-to-launch variance dominates. Each is a
      # separate Playwright invocation so every launch is genuinely cold.
      - name: Measure (launch 0)
        env:
          BUILD: ${{ steps.build.outputs.BUILD }}
          MEMORY_SCENARIO: idle
          MEMORY_LAUNCH_INDEX: 0
        run: npx playwright test test/e2e/tests/performance/memory-idle.test.ts --project e2e-electron --grep 'Idle memory footprint'

      - name: Measure (launch 1)
        env:
          BUILD: ${{ steps.build.outputs.BUILD }}
          MEMORY_SCENARIO: idle
          MEMORY_LAUNCH_INDEX: 1
        run: npx playwright test test/e2e/tests/performance/memory-idle.test.ts --project e2e-electron --grep 'Idle memory footprint'

      - name: Measure (launch 2)
        env:
          BUILD: ${{ steps.build.outputs.BUILD }}
          MEMORY_SCENARIO: idle
          MEMORY_LAUNCH_INDEX: 2
        run: npx playwright test test/e2e/tests/performance/memory-idle.test.ts --project e2e-electron --grep 'Idle memory footprint'

      - name: Render and publish report
        env:
          BUILD: ${{ steps.build.outputs.BUILD }}
          MEMORY_AGGREGATE: 'true'
          CONNECT_API_KEY: ${{ secrets.CONNECT_API_KEY }}
        run: npx playwright test test/e2e/tests/performance/memory-idle.test.ts --project e2e-electron --grep 'Render and publish'

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: memory-report
          # Matches SNAPSHOT_DIR in the spec. Deliberately not test-results/,
          # which Playwright wipes at the start of every invocation.
          path: ${{ runner.temp }}/memory-snapshots/
```

- [x] **Step 3: Validate the workflow syntax**

```bash
gh workflow view test-memory-metrics.yml --repo posit-dev/positron 2>/dev/null || echo "not yet pushed, syntax checked on push"
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/test-memory-metrics.yml')); print('valid yaml')"
```

Expected: `valid yaml`.

- [x] **Step 4: Commit and dispatch a real run**

```bash
npm run precommit -- .github/workflows/test-memory-metrics.yml
git add .github/workflows/test-memory-metrics.yml
git commit -m "ci: add nightly idle memory metrics workflow"
git push -u origin HEAD
gh workflow run test-memory-metrics.yml --ref "$(git branch --show-current)"
```

Then watch it and read the step summary:

```bash
gh run watch "$(gh run list --workflow=test-memory-metrics.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: three measure steps pass, the report step prints a markdown table, and `memory-report` appears as an artifact. Publishing will fail until the dashboard plan lands, which is expected and must not fail the job.

- [x] **Step 5: Record the observed variance**

Compare the three launch totals in the step summary. Note the spread in the PR description. This is the number phase 2 needs to choose an alert threshold, and it is the answer to the spec's main open risk. If the spread exceeds roughly 5%, say so explicitly, because it means the idle total alone will not detect small regressions and per-process rows carry the load.

**Measured, on run 31401098950 (2026.08.0-331, ubuntu24 container, 8x runner):**

| Launch | Total PSS | Settle |
| --- | --- | --- |
| 0 | 1789.4 MB | 3110 ms |
| 1 | 1768.0 MB | 3117 ms |
| 2 | 1752.2 MB | 3101 ms |

Spread is **2.1% of the median**, comfortably inside the 5% budget, so the idle total
is usable on its own for regressions above roughly 2%. Settle time is strikingly
consistent (3101-3117 ms), which suggests the 90s cap is never approached and the
three-stable-readings rule fires at the earliest opportunity; worth revisiting whether
the tree is genuinely settled that fast or whether the 1% tolerance is too loose.

Median composition: renderer 498.8 MB, extension_host 492.4 MB, main 166.6 MB,
unlabeled 124.8 MB, shared 118.7 MB, gpu 92.5 MB, agent_host 63.3 MB,
extension_child 62.2 MB, pty_host 49.8 MB, file_watcher 46.7 MB, network 24.3 MB,
kernel_supervisor 6.9 MB, language_server 6.9 MB. Total 1.7 GB across 20 processes.

Two follow-ups this run surfaced:

- **Unlabeled is 124.8 MB, 7.3% of the tree, across 8 process names.** Inside the
  one-third gate but worth closing. CI has more installed than the local container did,
  so names appear here that never showed up before: `charliermarsh.ruff` language
  servers (two versions), bundled `jsonServerMain`-style servers, and Chromium's
  `zygote`. The ruff and server processes belong in `language_server`; per Task 9
  Step 5 this is the signal to add rules to `label.ts`.
- **Publishing failed soft against `127.0.0.1:8000`**, which is the branch gate working:
  `apiUrl` only uses the production endpoint on `main`. Nothing to fix, but it means a
  nightly on a branch can never write to the real dataset, and the first genuine publish
  will not happen until this is on `main` with the endpoint live.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
| --- | --- |
| Idle scenario, `interpreters.startupBehavior: manual` | Task 9, Steps 2-3 |
| Settle detection with 90s cap, `settle_ms` | Task 5 |
| Three launches with `launch_index` | Tasks 5, 9, 11 |
| PSS not RSS, `smaps_rollup` | Task 3 |
| Ubuntu container only | Task 11 |
| Names from `--status`, numbers from OS, join on PID | Tasks 3, 4, 5 |
| Fixed `process_role` vocabulary, no titles in role | Task 2 |
| `unlabeled` degradation | Tasks 2, 5, 7 |
| Extension inventory, degrades on failure | Task 6 |
| Two datasets / payload shape | Task 8 |
| Batched POST, branch-gated publish | Task 8 |
| Step summary and HTML artifact | Tasks 7, 9, 10 |
| Delta against previous nightly | Tasks 7, 8 |
| Nightly cron plus dispatch, released build | Tasks 10, 11 |
| Vitest glob extension | Task 2 |
| Container image recorded | Tasks 8, 11 |

**Gap found and closed:** the spec pins `interpreters.startupBehavior` to `manual`, and no task originally set it. Task 9 Steps 2 and 3 now add `test/e2e/fixtures/settingsMemory.json` and merge it in `copyUserSettings`, gated on `MEMORY_SCENARIO=idle`, following the existing `ALLOW_PYREFLY` pattern. It has to be pre-launch, so a mid-session settings change would not have worked.

**Type consistency:** checked. `resolveRole`, `readProcessTree`, `parseSmapsRollup`, `parsePpid`, `parseStatusOutput`, `readProcessNames`, `joinProcesses`, `captureSnapshot`, `renderMarkdown`, `renderHtml`, `formatBytes`, `publishSnapshots`, and `fetchBaseline` are each defined once and referenced with matching signatures. Field names are camelCase throughout the TypeScript types and snake_case only inside `MemoryPayload`, which is the wire format.

**Deferred to the dashboard plan (posit-dev/e2e-test-insights):** `POST /memory`, `GET /memory/baseline`, the two parquet datasets, and the Memory sub-tab with its four charts. The `MemoryPayload` and `BaselineResponse` types in Task 8 are the contract, and `payload_version` is 1.

## Design review response (job 4730)

Findings from `/roborev-design-review`, and what changed. The three highest-severity ones were verified against the repo before acting.

| Finding | Resolution |
| --- | --- |
| `download-build.sh` is macOS-only (verified: line 51 hard-codes `Positron-darwin-...zip`) | New Task 10 generalizes it. `Positron-linux-<v>-<arch>.tar.gz` exists in every release and nothing consumed it before. |
| Container needs GHCR credentials (verified against `test-e2e-ubuntu-run.yml:105`) | Added, along with `--user 0:0`, which is also needed to read another process's `smaps_rollup`. |
| Snapshots do not survive between invocations (verified: `outputDir` unset, so Playwright wipes `test-results/` each run) | Moved to `$RUNNER_TEMP/memory-snapshots`, and aggregation now requires exactly 3. |
| `BUILD` missing from the sample YAML | Wired on every measure step and on the report step. |
| GET baseline shape unspecified | `BaselineResponse` added, with `{found: false}` on 200 rather than a 404. |
| Task 1 fixtures never consumed | Task 3 now parses them, asserting `RSS >= PSS`. |
| `utility_other` unreachable | Removed. Added a test for the more useful case: Positron named it, we have not mapped it. |
| Extension selectors could break silently | Task 9 now asserts a non-empty inventory. |
| No quality gate on degraded data | Task 9 fails if under half the processes are named or over a third of memory is unattributed. Fail-soft is right for a report and wrong for a baseline. |
| No payload versioning | `payload_version: 1`. |
| Window titles published | `redactProcessName` strips the title before publishing; the local HTML keeps it. |

The review found no problem with the measurement approach itself. PSS over RSS, the names-from-Positron/numbers-from-the-OS split, the `unlabeled` degradation model, and the three-launch variance design all came through unchanged.
