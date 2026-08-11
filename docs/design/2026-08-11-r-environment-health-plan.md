# R Environment Health Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `r.getEnvironmentHealth` command to positron-r that reports, as JSON, whether the current R setup is ready to start a session, with an actionable fix per failing item.

**Architecture:** One new module, `extensions/positron-r/src/environmentHealth.ts`, holding pure `probe*` functions that take plain dependency objects plus an `assembleItems` orchestrator that runs four checks in dependency order and short-circuits later items to `skipped`. All probes are static: they read files on disk, spawn nothing, and need no R session. A supporting change hardens `r.renvInit` so its fix button works from a cold workbench.

**Tech Stack:** TypeScript, VS Code extension API, `positron` API (`src/positron-dts/positron.d.ts`), Mocha TDD + sinon running in the extension host.

**Spec:** `docs/design/2026-08-11-r-environment-health-design.md`. Read it before starting.

## Global Constraints

- Indentation is **tabs** in this extension (the repo default; `positron-python` differs, this one does not).
- Copyright header on every new file: `Copyright (C) 2026 Posit Software, PBC. All rights reserved.` followed by the Elastic License 2.0 line. Copy the exact block from `extensions/positron-r/src/kernel.ts:1-4`.
- ASCII only. No em-dashes, en-dashes, smart quotes.
- Localize user-facing strings with `vscode.l10n.t(...)`. This extension does **not** use `nls`.
- Declarative strings (command titles) go in `package.nls.json`, referenced from `package.json` as `%key%`.
- Minimum R version comes from `MINIMUM_R_VERSION` in `./constants` (currently `4.2.0`). Never hardcode it.
- Minimum renv version comes from `MINIMUM_RENV_VERSION` in `./constants` (currently `1.0.9`).
- Log via `LOGGER` from `./extension` (a `vscode.LogOutputChannel`). There is no `traceInfo` here.
- The health check command must **never reject**. Every probe runs inside a wrapper that converts a throw into a `fail` item.
- `learnMoreUrl` for R installation problems is `https://positron.posit.co/r-installations` (verified live).
- Do not run `npx tsc` against the root project. Use `npm run build-check` if you need a compile check.
- Commit with explicit paths. Never `git add -A` (a `node_modules` symlink gets tracked in worktrees).

## File Structure

| File | Responsibility |
|---|---|
| `extensions/positron-r/src/environmentHealth.ts` (create) | Types, the four probes, libR path resolution, arch comparison, `assembleItems`, `getEnvironmentHealth` orchestrator |
| `extensions/positron-r/src/provider.ts` (modify) | Export a new `discoverRInstallations()`; refactor `rRuntimeDiscoverer` to use it |
| `extensions/positron-r/src/commands.ts` (modify) | Register the two commands; harden `r.renvInit` |
| `extensions/positron-r/package.json` (modify) | Declare `r.printEnvironmentHealth` |
| `extensions/positron-r/package.nls.json` (modify) | Title for that command |
| `extensions/positron-r/src/test/environmentHealth.unit.test.ts` (create) | Probe, cascade, libR path, arch tests |
| `extensions/positron-r/src/test/renvInit.unit.test.ts` (create) | Session-ordering tests for the hardened command |

Tasks 1-3 build the module bottom-up (pure helpers, then probes, then orchestrator), Task 4 wires the commands, Task 5 hardens `r.renvInit`. Tasks 1-3 have no dependency on Positron APIs and are testable in isolation.

---

### Task 1: libR path resolution and architecture comparison

The two platform-sensitive helpers. Built first because they are pure, and because three of the four libR rows cannot be checked by hand on any single machine.

**Files:**
- Create: `extensions/positron-r/src/environmentHealth.ts`
- Create: `extensions/positron-r/src/test/environmentHealth.unit.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type ArkArch = 'arm64' | 'x64';`
  - `export function resolveLibRPath(rHome: string, platform: NodeJS.Platform, arkArch: ArkArch | undefined): string`
  - `export function archesMismatch(rArch: string | undefined, arkArch: ArkArch | undefined): boolean`

**Background:** these mirror ark's own resolution in `crates/harp/src/sys/{unix,windows}/library.rs`. Windows arm64 uses a **flatter** layout (`bin/R.dll`, not `bin/arm64/R.dll`). Getting this wrong reports libR missing on a healthy install.

- [ ] **Step 1: Write the failing tests**

Create `extensions/positron-r/src/test/environmentHealth.unit.test.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import './mocha-setup';
import { archesMismatch, resolveLibRPath } from '../environmentHealth';

suite('environment health: libR path resolution', () => {
	// Mirrors harp::find_r_shared_library_folder. Windows arm64 is deliberately
	// flat; see crates/harp/src/sys/windows/library.rs:107-117.
	const cases: Array<{
		name: string;
		platform: NodeJS.Platform;
		arkArch: 'arm64' | 'x64' | undefined;
		expected: string[];
	}> = [
			{ name: 'macOS', platform: 'darwin', arkArch: 'arm64', expected: ['lib', 'libR.dylib'] },
			{ name: 'Linux', platform: 'linux', arkArch: 'x64', expected: ['lib', 'libR.so'] },
			{ name: 'Windows x64', platform: 'win32', arkArch: 'x64', expected: ['bin', 'x64', 'R.dll'] },
			{ name: 'Windows arm64', platform: 'win32', arkArch: 'arm64', expected: ['bin', 'R.dll'] },
		];

	for (const c of cases) {
		test(`${c.name} resolves the ark-compatible libR path`, () => {
			const rHome = path.join('/opt', 'R', '4.4.1');
			assert.strictEqual(
				resolveLibRPath(rHome, c.platform, c.arkArch),
				path.join(rHome, ...c.expected)
			);
		});
	}

	test('Windows with unknown ark arch falls back to the x64 layout', () => {
		// x64 is the overwhelmingly common Windows R install, so an unknown ark
		// arch should not send us looking in the rarer flat arm64 location.
		const rHome = path.join('C:', 'R', 'R-4.4.1');
		assert.strictEqual(
			resolveLibRPath(rHome, 'win32', undefined),
			path.join(rHome, 'bin', 'x64', 'R.dll')
		);
	});
});

suite('environment health: architecture comparison', () => {
	test('reports a mismatch when R and ark differ', () => {
		assert.strictEqual(archesMismatch('x86_64', 'arm64'), true);
	});

	test('normalizes x64 and x86_64 as the same architecture', () => {
		// The two sniffers use different vocabularies: sniffWindowsBinaryArchitecture
		// returns 'x64', RInstallation.arch records 'x86_64'.
		assert.strictEqual(archesMismatch('x86_64', 'x64'), false);
	});

	test('treats arm64 on both sides as matching', () => {
		assert.strictEqual(archesMismatch('arm64', 'arm64'), false);
	});

	test('reports no mismatch when either side is unknown', () => {
		// A failed sniff is missing information, not evidence of a problem.
		assert.strictEqual(archesMismatch(undefined, 'arm64'), false);
		assert.strictEqual(archesMismatch('arm64', undefined), false);
		assert.strictEqual(archesMismatch('', undefined), false);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test-extension -- -l positron-r --grep "environment health"`

Expected: FAIL, cannot find module `../environmentHealth`.

- [ ] **Step 3: Write the minimal implementation**

Create `extensions/positron-r/src/environmentHealth.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { normalizeWindowsArch } from './kernel';

/** Architecture vocabulary used by the ark binary sniffers. */
export type ArkArch = 'arm64' | 'x64';

/**
 * Resolves the libR path exactly as ark does, so this check agrees with the
 * process that actually loads the library. See
 * `harp::find_r_shared_library_folder`.
 *
 * Platform and architecture are parameters rather than reads of `os.platform()`
 * so every row is testable on any machine.
 */
export function resolveLibRPath(
	rHome: string,
	platform: NodeJS.Platform,
	arkArch: ArkArch | undefined
): string {
	if (platform === 'win32') {
		// arm64 ark uses a flatter layout; everything else lives under bin/x64.
		const folder = arkArch === 'arm64'
			? path.join(rHome, 'bin')
			: path.join(rHome, 'bin', 'x64');
		return path.join(folder, 'R.dll');
	}
	const name = platform === 'darwin' ? 'libR.dylib' : 'libR.so';
	return path.join(rHome, 'lib', name);
}

/**
 * True when R and ark are built for different architectures. An unknown value
 * on either side yields false: missing information is not evidence of trouble.
 */
export function archesMismatch(rArch: string | undefined, arkArch: ArkArch | undefined): boolean {
	if (!rArch || !arkArch) {
		return false;
	}
	const normalizedR = normalizeWindowsArch(rArch);
	if (!normalizedR) {
		return false;
	}
	return normalizedR !== arkArch;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test-extension -- -l positron-r --grep "environment health"`

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/positron-r/src/environmentHealth.ts extensions/positron-r/src/test/environmentHealth.unit.test.ts
git commit -m "feat(r): add libR path and architecture helpers for the health check"
```

---

### Task 2: Health item types and the four probes

**Files:**
- Modify: `extensions/positron-r/src/environmentHealth.ts`
- Modify: `extensions/positron-r/src/test/environmentHealth.unit.test.ts`

**Interfaces:**
- Consumes: `resolveLibRPath`, `archesMismatch`, `ArkArch` from Task 1
- Produces:
  - `export type HealthItemStatus = 'pass' | 'warn' | 'fail' | 'skipped';`
  - `export type HealthItemId = 'discovery' | 'rInstalled' | 'environmentReady' | 'dedicatedEnvironment';`
  - `export interface HealthItemFix { commandId: string; args?: unknown[]; label: string; }`
  - `export interface HealthItem { id: HealthItemId; status: HealthItemStatus; summary: string; detail?: string; fix?: HealthItemFix; learnMoreUrl?: string; }`
  - `export function probeDiscovery(deps: { binaryCount: number; error?: string }): HealthItem`
  - `export function probeRInstalled(deps: { installations: RInstallationLike[] }): HealthItem`
  - `export function probeEnvironmentReady(deps: { usable: boolean; rejectedReason?: string; versionSupported: boolean; version: string; arkFound: boolean; libRPath: string; libRExists: boolean; archMismatch: boolean; rArch?: string; arkArch?: ArkArch; }): HealthItem`
  - `export function probeDedicatedEnvironment(deps: { workspaceFolderPath?: string; hasRenv: boolean }): HealthItem`
  - `export interface RInstallationLike { binpath: string; usable: boolean; supported: boolean; version: string; reasonRejected: string | null; }`

`RInstallationLike` is a structural subset of `RInstallation` so probes stay testable without constructing real installations.

- [ ] **Step 1: Write the failing tests**

Append to `extensions/positron-r/src/test/environmentHealth.unit.test.ts`. Add these imports to the existing import block at the top of the file:

```ts
import {
	probeDedicatedEnvironment,
	probeDiscovery,
	probeEnvironmentReady,
	probeRInstalled,
	RInstallationLike,
} from '../environmentHealth';
```

Then append:

```ts
function installation(over: Partial<RInstallationLike> = {}): RInstallationLike {
	return {
		binpath: '/opt/R/4.4.1/bin/R',
		usable: true,
		supported: true,
		version: '4.4.1',
		reasonRejected: null,
		...over,
	};
}

const READY_OK = {
	usable: true,
	versionSupported: true,
	version: '4.4.1',
	arkFound: true,
	libRPath: '/opt/R/4.4.1/lib/libR.dylib',
	libRExists: true,
	archMismatch: false,
	rArch: 'arm64',
	arkArch: 'arm64' as const,
};

suite('environment health: probeDiscovery', () => {
	test('passes when binaries were found', () => {
		assert.strictEqual(probeDiscovery({ binaryCount: 2 }).status, 'pass');
	});

	test('fails with a diagnostics fix when no binaries were found', () => {
		const item = probeDiscovery({ binaryCount: 0 });
		assert.strictEqual(item.status, 'fail');
		assert.strictEqual(item.fix?.commandId, 'positron.startupDiagnostics.show');
	});

	test('fails and reports the error when discovery threw', () => {
		const item = probeDiscovery({ binaryCount: 0, error: 'boom' });
		assert.strictEqual(item.status, 'fail');
		assert.ok(item.detail?.includes('boom'));
	});
});

suite('environment health: probeRInstalled', () => {
	test('passes when a usable supported install exists', () => {
		assert.strictEqual(probeRInstalled({ installations: [installation()] }).status, 'pass');
	});

	test('fails when every install is unusable, naming the reason', () => {
		const item = probeRInstalled({
			installations: [installation({ usable: false, reasonRejected: 'nonOrthogonal' })],
		});
		assert.strictEqual(item.status, 'fail');
		assert.ok(item.detail?.includes('nonOrthogonal'));
	});

	test('fails when the only install is below the minimum version', () => {
		// RInstallation always sets usable=false and reasonRejected='unsupported'
		// for an old R (r-installation.ts:320-340), so this is what real data
		// looks like. The version must still surface, not a generic reason.
		const item = probeRInstalled({
			installations: [installation({
				usable: false, supported: false, version: '4.0.5', reasonRejected: 'unsupported',
			})],
		});
		assert.strictEqual(item.status, 'fail');
		assert.ok(item.detail?.includes('4.0.5'));
	});

	test('offers no fix but does link to the discovery docs', () => {
		// There is no install-R command in the repo, unlike python.installPythonViaUv.
		const item = probeRInstalled({ installations: [] });
		assert.strictEqual(item.fix, undefined);
		assert.strictEqual(item.learnMoreUrl, 'https://positron.posit.co/r-installations');
	});
});

suite('environment health: probeEnvironmentReady', () => {
	test('passes when every gate is satisfied', () => {
		assert.strictEqual(probeEnvironmentReady(READY_OK).status, 'pass');
	});

	test('fails when the installation is not usable, reporting the reason', () => {
		const item = probeEnvironmentReady({
			...READY_OK, usable: false, rejectedReason: 'invalid',
		});
		assert.strictEqual(item.status, 'fail');
		assert.ok(item.detail?.includes('invalid'));
	});

	test('fails on an unsupported version', () => {
		const item = probeEnvironmentReady({
			...READY_OK, versionSupported: false, version: '4.0.5',
		});
		assert.strictEqual(item.status, 'fail');
		assert.ok(item.detail?.includes('4.0.5'));
	});

	test('fails when the ark kernel cannot be located', () => {
		const item = probeEnvironmentReady({ ...READY_OK, arkFound: false });
		assert.strictEqual(item.status, 'fail');
	});

	test('fails when libR is missing, naming the path and R-shlib', () => {
		const item = probeEnvironmentReady({ ...READY_OK, libRExists: false });
		assert.strictEqual(item.status, 'fail');
		assert.ok(item.detail?.includes('/opt/R/4.4.1/lib/libR.dylib'));
		assert.ok(item.detail?.includes('--enable-R-shlib'));
	});

	test('checks ark before libR, because libR resolution needs ark arch', () => {
		const item = probeEnvironmentReady({ ...READY_OK, arkFound: false, libRExists: false });
		assert.ok(!item.detail?.includes('--enable-R-shlib'));
	});

	test('warns without failing on an architecture mismatch', () => {
		const item = probeEnvironmentReady({
			...READY_OK, archMismatch: true, rArch: 'x86_64', arkArch: 'arm64',
		});
		assert.strictEqual(item.status, 'warn');
		assert.ok(item.detail?.includes('x86_64'));
		assert.ok(item.detail?.includes('arm64'));
	});
});

suite('environment health: probeDedicatedEnvironment', () => {
	test('passes when the open folder has an renv project', () => {
		const item = probeDedicatedEnvironment({ workspaceFolderPath: '/work/proj', hasRenv: true });
		assert.strictEqual(item.status, 'pass');
	});

	test('fails with the renv fix when the open folder has no renv project', () => {
		const item = probeDedicatedEnvironment({ workspaceFolderPath: '/work/proj', hasRenv: false });
		assert.strictEqual(item.status, 'fail');
		assert.strictEqual(item.fix?.commandId, 'r.renvInit');
		assert.ok(item.detail?.includes('/work/proj'));
	});

	test('warns with the new-folder fix when no folder is open', () => {
		const item = probeDedicatedEnvironment({ hasRenv: false });
		assert.strictEqual(item.status, 'warn');
		assert.strictEqual(item.fix?.commandId, 'positron.workbench.action.newFolderFromTemplate');
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test-extension -- -l positron-r --grep "environment health"`

Expected: FAIL, `probeDiscovery` is not exported.

- [ ] **Step 3: Write the minimal implementation**

Add to `extensions/positron-r/src/environmentHealth.ts`. Add `import * as vscode from 'vscode';` to the import block.

```ts
export type HealthItemStatus = 'pass' | 'warn' | 'fail' | 'skipped';

/** The four checks, in dependency order. */
export type HealthItemId = 'discovery' | 'rInstalled' | 'environmentReady' | 'dedicatedEnvironment';

export interface HealthItemFix {
	/** Extension OR core command id. */
	commandId: string;
	/** Fully computed at check time; plain JSON only (no vscode types). */
	args?: unknown[];
	/** Localized button label. */
	label: string;
}

export interface HealthItem {
	id: HealthItemId;
	status: HealthItemStatus;
	/** Localized one-liner. */
	summary: string;
	/** Localized, with actual paths and versions. */
	detail?: string;
	fix?: HealthItemFix;
	learnMoreUrl?: string;
}

/** Structural subset of RInstallation, so probes are testable without real installs. */
export interface RInstallationLike {
	binpath: string;
	usable: boolean;
	supported: boolean;
	version: string;
	reasonRejected: string | null;
}

const R_INSTALL_DOCS = 'https://positron.posit.co/r-installations';

function diagnosticsFix(): HealthItemFix {
	return {
		commandId: 'positron.startupDiagnostics.show',
		label: vscode.l10n.t('Show Runtime Startup Diagnostics'),
	};
}

export function probeDiscovery(deps: { binaryCount: number; error?: string }): HealthItem {
	const id = 'discovery';
	const summary = vscode.l10n.t('Positron can discover R installations');
	if (deps.error) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t('R discovery could not complete: {0}', deps.error),
			fix: diagnosticsFix(),
		};
	}
	if (deps.binaryCount === 0) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t('No R installations were found on this machine.'),
			fix: diagnosticsFix(),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	return { id, status: 'pass', summary };
}

export function probeRInstalled(deps: { installations: RInstallationLike[] }): HealthItem {
	const id = 'rInstalled';
	const summary = vscode.l10n.t('A supported R is installed');
	if (deps.installations.some((i) => i.usable && i.supported)) {
		return { id, status: 'pass', summary };
	}

	// Explain why the closest candidate did not qualify rather than just
	// reporting absence: the user usually does have R, just not one we can use.
	// Version is checked before the generic rejection branch because an old R is
	// always ALSO marked unusable (r-installation.ts:320-340), and "your R is
	// 4.0.5" is more actionable than "unusable: unsupported".
	const unsupported = deps.installations.find((i) => !i.supported);
	if (unsupported) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t(
				'The R installation at {0} is version {1}, below the minimum supported version.',
				unsupported.binpath, unsupported.version),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	const rejected = deps.installations.find((i) => !i.usable);
	if (rejected) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t(
				'The R installation at {0} is unusable: {1}.',
				rejected.binpath, rejected.reasonRejected ?? 'unknown'),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	return {
		id, status: 'fail', summary,
		detail: vscode.l10n.t('No R installations were found on this machine.'),
		learnMoreUrl: R_INSTALL_DOCS,
	};
}

export function probeEnvironmentReady(deps: {
	usable: boolean;
	rejectedReason?: string;
	versionSupported: boolean;
	version: string;
	arkFound: boolean;
	libRPath: string;
	libRExists: boolean;
	archMismatch: boolean;
	rArch?: string;
	arkArch?: ArkArch;
}): HealthItem {
	const id = 'environmentReady';
	const summary = vscode.l10n.t('The R installation is ready to use with Positron');

	if (!deps.usable) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t(
				'This R installation is unusable: {0}.', deps.rejectedReason ?? 'unknown'),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	if (!deps.versionSupported) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t(
				'This R installation is version {0}, below the minimum supported version.',
				deps.version),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	// Ark precedes libR because resolving the libR path needs ark's architecture.
	if (!deps.arkFound) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t('The R kernel (ark) could not be located in this installation of Positron.'),
			fix: diagnosticsFix(),
		};
	}
	if (!deps.libRExists) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t(
				"R's shared library was not found at {0}. If this is a custom build of R, ensure it is compiled with --enable-R-shlib.",
				deps.libRPath),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	if (deps.archMismatch) {
		return {
			id, status: 'warn', summary,
			detail: vscode.l10n.t(
				'This R is built for {0} but the R kernel is built for {1}. Sessions may fail to start or run slowly.',
				deps.rArch ?? 'unknown', deps.arkArch ?? 'unknown'),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	return { id, status: 'pass', summary };
}

export function probeDedicatedEnvironment(deps: {
	workspaceFolderPath?: string;
	hasRenv: boolean;
}): HealthItem {
	const id = 'dedicatedEnvironment';
	const summary = vscode.l10n.t('The workspace uses a dedicated R environment');

	if (!deps.workspaceFolderPath) {
		return {
			id, status: 'warn', summary,
			detail: vscode.l10n.t('No folder is open. Open or create a folder to use a project-local renv library.'),
			fix: {
				commandId: 'positron.workbench.action.newFolderFromTemplate',
				label: vscode.l10n.t('New Folder from Template'),
			},
		};
	}
	if (deps.hasRenv) {
		return { id, status: 'pass', summary };
	}
	return {
		id, status: 'fail', summary,
		detail: vscode.l10n.t(
			'{0} does not use renv. Initialize renv to isolate this project\'s packages.',
			deps.workspaceFolderPath),
		fix: { commandId: 'r.renvInit', label: vscode.l10n.t('Initialize renv') },
	};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test-extension -- -l positron-r --grep "environment health"`

Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add extensions/positron-r/src/environmentHealth.ts extensions/positron-r/src/test/environmentHealth.unit.test.ts
git commit -m "feat(r): add the four environment health probes"
```

---

### Task 3: The cascade orchestrator

**Files:**
- Modify: `extensions/positron-r/src/environmentHealth.ts`
- Modify: `extensions/positron-r/src/test/environmentHealth.unit.test.ts`

**Interfaces:**
- Consumes: `HealthItem`, `HealthItemId` from Task 2
- Produces:
  - `export interface REnvironmentHealthResult { ok: boolean; items: HealthItem[]; rBinPath?: string; rHome?: string; }`
  - `export async function assembleItems(producers: { discovery: () => HealthItem | Promise<HealthItem>; rInstalled: () => HealthItem | Promise<HealthItem>; ready: () => HealthItem | Promise<HealthItem>; dedicated: () => HealthItem | Promise<HealthItem>; }): Promise<REnvironmentHealthResult>`

- [ ] **Step 1: Write the failing tests**

Add `assembleItems` and `REnvironmentHealthResult` to the test file's import block, then append:

```ts
suite('environment health: assembleItems cascade', () => {
	const pass = (id: HealthItemId): HealthItem => ({ id, status: 'pass', summary: id });
	const fail = (id: HealthItemId): HealthItem => ({ id, status: 'fail', summary: id });
	const warn = (id: HealthItemId): HealthItem => ({ id, status: 'warn', summary: id });

	const allPass = {
		discovery: () => pass('discovery'),
		rInstalled: () => pass('rInstalled'),
		ready: () => pass('environmentReady'),
		dedicated: () => pass('dedicatedEnvironment'),
	};

	test('reports ok with four items when everything passes', async () => {
		const result = await assembleItems(allPass);
		assert.strictEqual(result.ok, true);
		assert.deepStrictEqual(result.items.map((i) => i.id),
			['discovery', 'rInstalled', 'environmentReady', 'dedicatedEnvironment']);
	});

	test('a discovery failure skips the other three', async () => {
		const result = await assembleItems({ ...allPass, discovery: () => fail('discovery') });
		assert.strictEqual(result.ok, false);
		assert.deepStrictEqual(result.items.map((i) => i.status),
			['fail', 'skipped', 'skipped', 'skipped']);
	});

	test('an rInstalled failure skips the last two', async () => {
		const result = await assembleItems({ ...allPass, rInstalled: () => fail('rInstalled') });
		assert.deepStrictEqual(result.items.map((i) => i.status),
			['pass', 'fail', 'skipped', 'skipped']);
	});

	test('an environmentReady failure skips only dedicatedEnvironment', async () => {
		const result = await assembleItems({ ...allPass, ready: () => fail('environmentReady') });
		assert.deepStrictEqual(result.items.map((i) => i.status),
			['pass', 'pass', 'fail', 'skipped']);
	});

	test('a warn does not flip ok and does not short-circuit', async () => {
		const result = await assembleItems({ ...allPass, ready: () => warn('environmentReady') });
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.items[3].status, 'pass');
	});

	test('a throwing producer becomes a fail item rather than rejecting', async () => {
		const result = await assembleItems({
			...allPass,
			ready: () => { throw new Error('kaboom'); },
		});
		assert.strictEqual(result.items[2].status, 'fail');
		assert.ok(result.items[2].detail?.includes('kaboom'));
		assert.strictEqual(result.items[3].status, 'skipped');
	});
});
```

Add `HealthItem` and `HealthItemId` to the import block if not already present.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test-extension -- -l positron-r --grep "assembleItems"`

Expected: FAIL, `assembleItems` is not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `extensions/positron-r/src/environmentHealth.ts`:

```ts
export interface REnvironmentHealthResult {
	/** True when no item has status 'fail'. Warn and skipped do not affect it. */
	ok: boolean;
	/** Always all four, in dependency order. */
	items: HealthItem[];
	rBinPath?: string;
	rHome?: string;
}

function skipped(id: HealthItemId): HealthItem {
	return { id, status: 'skipped', summary: id };
}

async function runItem(
	id: HealthItemId,
	produce: () => HealthItem | Promise<HealthItem>
): Promise<HealthItem> {
	try {
		return await produce();
	} catch (ex) {
		return {
			id, status: 'fail', summary: id,
			detail: vscode.l10n.t(
				'Health check failed: {0}', ex instanceof Error ? ex.message : String(ex)),
		};
	}
}

function finalize(items: HealthItem[]): REnvironmentHealthResult {
	return { ok: !items.some((i) => i.status === 'fail'), items };
}

export async function assembleItems(producers: {
	discovery: () => HealthItem | Promise<HealthItem>;
	rInstalled: () => HealthItem | Promise<HealthItem>;
	ready: () => HealthItem | Promise<HealthItem>;
	dedicated: () => HealthItem | Promise<HealthItem>;
}): Promise<REnvironmentHealthResult> {
	const items: HealthItem[] = [];

	const discovery = await runItem('discovery', producers.discovery);
	items.push(discovery);
	if (discovery.status === 'fail') {
		items.push(skipped('rInstalled'), skipped('environmentReady'), skipped('dedicatedEnvironment'));
		return finalize(items);
	}

	const rInstalled = await runItem('rInstalled', producers.rInstalled);
	items.push(rInstalled);
	if (rInstalled.status === 'fail') {
		items.push(skipped('environmentReady'), skipped('dedicatedEnvironment'));
		return finalize(items);
	}

	// dedicatedEnvironment follows environmentReady: an unusable R makes the
	// renv verdict meaningless, and a "use renv" nudge alongside a broken
	// installation is misleading advice.
	const ready = await runItem('environmentReady', producers.ready);
	items.push(ready);
	if (ready.status === 'fail') {
		items.push(skipped('dedicatedEnvironment'));
		return finalize(items);
	}

	items.push(await runItem('dedicatedEnvironment', producers.dedicated));
	return finalize(items);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test-extension -- -l positron-r --grep "environment health"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/positron-r/src/environmentHealth.ts extensions/positron-r/src/test/environmentHealth.unit.test.ts
git commit -m "feat(r): add the health check cascade orchestrator"
```

---

### Task 4: Wire up discovery, the orchestrator, and the two commands

**Files:**
- Modify: `extensions/positron-r/src/provider.ts:243-270`
- Modify: `extensions/positron-r/src/environmentHealth.ts`
- Modify: `extensions/positron-r/src/commands.ts`
- Modify: `extensions/positron-r/package.json:148-153`
- Modify: `extensions/positron-r/package.nls.json`

**Interfaces:**
- Consumes: everything from Tasks 1-3
- Produces:
  - `export async function discoverRInstallations(): Promise<RInstallation[]>` in `provider.ts`
  - `export async function getEnvironmentHealth(args?: { workspaceFolder?: string }): Promise<REnvironmentHealthResult>` in `environmentHealth.ts`

`getBinaries` is currently private (`provider.ts:362`), and `rRuntimeDiscoverer` filters out unusable installs. The health check needs the **unfiltered** list so `rInstalled` can explain why a rejected install did not qualify, hence the new export.

- [ ] **Step 1: Extract `discoverRInstallations` in provider.ts**

Replace the promotion block at `provider.ts:255-270` so both callers share it. Add above `rRuntimeDiscoverer`:

```ts
/**
 * Discovers R binaries and promotes them to R installations, without filtering
 * on `usable`. Callers that only want startable runtimes should filter
 * themselves; the health check needs the rejects in order to explain them.
 */
export async function discoverRInstallations(): Promise<RInstallation[]> {
	const { binaries, currentBinary } = await getBinaries();
	return binaries.map(rbin => new RInstallation(
		rbin.path,
		rbin.path === currentBinary,
		rbin.reasons,
		rbin.packagerMetadata
	));
}
```

Then inside `rRuntimeDiscoverer`, replace lines 245 and 255-270 so it reads:

```ts
	const rAll = await discoverRInstallations();

	// If no R binaries are found, log to output and end discovery.
	if (rAll.length === 0) {
		LOGGER.warn('Positron could not find any R installations. Please verify that you have R installed and review any custom settings.');
		printInterpreterSettingsInfo();
		return;
	}

	// Filter out rejected R installations
	const rejectedRInstallations: RInstallation[] = [];
	const rInstallations: RInstallation[] = rAll.filter(r => {
		if (!r.usable) {
			LOGGER.info(`Filtering out ${r.binpath}, reason: ${friendlyReason(r.reasonRejected)}.`);
			rejectedRInstallations.push(r);
			return false;
		}
		return true;
	});
```

- [ ] **Step 2: Verify the refactor did not break discovery**

Run: `npm run test-extension -- -l positron-r --grep "discovery|rversions|deduplicate"`

Expected: PASS, same as before the change. This step exists because `rRuntimeDiscoverer` is on the startup path; a regression here breaks all R sessions.

- [ ] **Step 3: Add the orchestrator**

Append to `extensions/positron-r/src/environmentHealth.ts`. Add these imports:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as positron from 'positron';
import { discoverRInstallations } from './provider';
import { RInstallation } from './r-installation';
import { getArkKernelPath, sniffMachOBinaryArchitecture, sniffWindowsBinaryArchitecture } from './kernel';
import { LOGGER } from './extension';
```

`RInstallation` structurally satisfies `RInstallationLike`, so it can be passed to `probeRInstalled` directly while still giving the readiness probe access to `homepath` and `arch`.

```ts
/** Sniffs the architecture of the resolved ark binary, not of R. */
function arkArchitecture(arkPath: string | undefined): ArkArch | undefined {
	if (!arkPath) {
		return undefined;
	}
	if (os.platform() === 'win32') {
		return sniffWindowsBinaryArchitecture(arkPath);
	}
	if (os.platform() === 'darwin') {
		const sniffed = sniffMachOBinaryArchitecture(arkPath);
		return sniffed === 'x86_64' ? 'x64' : sniffed;
	}
	// Linux: cross-architecture R is not a practical concern, so skip the check.
	return undefined;
}

function hasRenvProject(folderPath: string): boolean {
	return fs.existsSync(path.join(folderPath, 'renv.lock')) ||
		fs.existsSync(path.join(folderPath, 'renv', 'activate.R'));
}

function resolveWorkspaceFolderPath(workspaceFolder: string | undefined): string | undefined {
	if (workspaceFolder) {
		return vscode.Uri.parse(workspaceFolder).fsPath;
	}
	// First folder only; multi-root reporting is a frontend concern.
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export async function getEnvironmentHealth(
	args?: { workspaceFolder?: string }
): Promise<REnvironmentHealthResult> {
	const folderPath = resolveWorkspaceFolderPath(args?.workspaceFolder);

	// Discovery runs once and is memoized: later probes must read the same
	// snapshot, and re-running it would be wasteful and possibly inconsistent.
	let all: RInstallation[] = [];
	let discoveryError: string | undefined;
	try {
		all = await discoverRInstallations();
	} catch (ex) {
		discoveryError = ex instanceof Error ? ex.message : String(ex);
	}

	const preferred = await positron.runtime.getPreferredRuntime('r');
	// runtimePath is set directly from RInstallation.binpath in makeMetadata,
	// so this join is exact rather than heuristic.
	const target = preferred
		? all.find((i) => i.binpath === preferred.runtimePath)
		: undefined;

	const result = await assembleItems({
		discovery: () => probeDiscovery({ binaryCount: all.length, error: discoveryError }),
		rInstalled: () => probeRInstalled({ installations: all }),
		ready: () => {
			if (!target) {
				throw new Error(
					`No preferred R installation could be resolved${preferred ? ` for ${preferred.runtimePath}` : ''}`);
			}
			const arkPath = getArkKernelPath({
				rBinaryPath: target.binpath,
				rHomePath: target.homepath,
				rArch: target.arch,
			});
			const arkArch = arkArchitecture(arkPath);
			const libRPath = resolveLibRPath(target.homepath, os.platform(), arkArch);
			return probeEnvironmentReady({
				usable: target.usable,
				rejectedReason: target.reasonRejected ?? undefined,
				versionSupported: target.supported,
				version: target.version,
				arkFound: arkPath !== undefined,
				libRPath,
				libRExists: fs.existsSync(libRPath),
				archMismatch: archesMismatch(target.arch, arkArch),
				rArch: target.arch,
				arkArch,
			});
		},
		dedicated: () => probeDedicatedEnvironment({
			workspaceFolderPath: folderPath,
			hasRenv: folderPath ? hasRenvProject(folderPath) : false,
		}),
	});

	result.rBinPath = target?.binpath;
	result.rHome = target?.homepath;
	return result;
}

export function logEnvironmentHealth(result: REnvironmentHealthResult): void {
	LOGGER.info('===================== [START] R ENVIRONMENT HEALTH =====================');
	LOGGER.info(JSON.stringify(result, null, 2));
	LOGGER.info('====================== [END] R ENVIRONMENT HEALTH ======================');
}
```

Note `ArkKernelLookupOptions` is currently a non-exported interface at `kernel.ts:16`. Export it so this call site type-checks, or pass the object literal inline as shown (structural typing makes the literal acceptable without the export).

- [ ] **Step 4: Register the commands**

In `commands.ts`, add to the import block:

```ts
import { getEnvironmentHealth, logEnvironmentHealth } from './environmentHealth';
```

Add inside the `context.subscriptions.push(...)` list, after the `r.interpreters.settingsInfo` registration:

```ts
		// Returns a JSON report on whether the current R setup can start a
		// session. Internal: consumed by a frontend, not surfaced in the palette.
		vscode.commands.registerCommand('r.getEnvironmentHealth',
			async (args?: { workspaceFolder?: string }) => getEnvironmentHealth(args)),

		// Developer probe: same report, logged to the R output channel.
		vscode.commands.registerCommand('r.printEnvironmentHealth', async () => {
			LOGGER.show();
			logEnvironmentHealth(await getEnvironmentHealth());
		}),
```

- [ ] **Step 5: Declare the palette command**

In `extensions/positron-r/package.json`, add to `contributes.commands` immediately after the `r.interpreters.settingsInfo` entry (which ends at line 153):

```json
      {
        "command": "r.printEnvironmentHealth",
        "category": "R",
        "title": "%r.command.printEnvironmentHealth.title%"
      },
```

In `extensions/positron-r/package.nls.json`, add alongside the other `r.command.*` keys:

```json
	"r.command.printEnvironmentHealth.title": "Print environment health report to Output",
```

- [ ] **Step 6: Verify it compiles and the suite still passes**

Run: `npm run build-check`

Expected: no errors in `extensions/positron-r`.

Run: `npm run test-extension -- -l positron-r --grep "environment health"`

Expected: PASS.

- [ ] **Step 7: Verify by hand**

Launch Positron, run **R: Print environment health report to Output** from the Command Palette, open Output and choose the **R Language Pack** channel. Confirm one JSON block between the `[START]` / `[END]` markers, with four items in order and `ok: true` on a healthy machine.

Then open a folder with no `renv.lock` and re-run: `dedicatedEnvironment` should be `fail` with the `r.renvInit` fix, and `ok` should be `false`.

- [ ] **Step 8: Commit**

```bash
git add extensions/positron-r/src/environmentHealth.ts extensions/positron-r/src/provider.ts extensions/positron-r/src/commands.ts extensions/positron-r/package.json extensions/positron-r/package.nls.json
git commit -m "feat(r): add the r.getEnvironmentHealth command"
```

---

### Task 5: Harden `r.renvInit` so the fix button works from a cold workbench

Must land in the same PR as Tasks 1-4. Shipped without it, the `dedicatedEnvironment` fix button fails with a misleading error.

**Files:**
- Modify: `extensions/positron-r/src/commands.ts:236-251`
- Create: `extensions/positron-r/src/test/renvInit.unit.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `export async function renvInit(): Promise<void>` in `commands.ts`

**Background, and read this carefully because the current code misleads.** `r.renvInit`'s visible no-session branch is `console.debug('[r.renvInit] no session available')`, but control never reaches it. `checkInstalled` runs first and resolves its own session via `RSessionManager.instance.getConsoleSession()`, throwing `Cannot check install status of renv; no R session available` when there is none (`session.ts:1216-1224`). So today the command rejects with a confusing error and that `console.debug` is dead code. **The session must be established before `checkInstalled`.**

- [ ] **Step 1: Write the failing tests**

Create `extensions/positron-r/src/test/renvInit.unit.test.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as Sinon from 'sinon';
import * as positron from 'positron';
import './mocha-setup';
import { renvInit } from '../commands';
import * as sessionModule from '../session';

suite('r.renvInit session handling', () => {
	let sandbox: Sinon.SinonSandbox;
	let execute: Sinon.SinonSpy;
	let fakeSession: { execute: Sinon.SinonSpy };

	setup(() => {
		sandbox = Sinon.createSandbox();
		execute = sandbox.spy();
		fakeSession = { execute };
	});

	teardown(() => sandbox.restore());

	test('uses the existing session and starts no runtime', async () => {
		sandbox.stub(positron.runtime, 'getForegroundSession').resolves(fakeSession as any);
		sandbox.stub(sessionModule, 'checkInstalled').resolves(true);
		const select = sandbox.stub(positron.runtime, 'selectLanguageRuntime').resolves();

		await renvInit();

		assert.strictEqual(select.called, false, 'must not restart a live session');
		assert.strictEqual(execute.calledOnce, true);
		assert.ok(execute.firstCall.args[0].includes('renv::init()'));
	});

	test('starts the preferred runtime when no session is running', async () => {
		const foreground = sandbox.stub(positron.runtime, 'getForegroundSession');
		foreground.onFirstCall().resolves(undefined);
		foreground.resolves(fakeSession as any);
		sandbox.stub(positron.runtime, 'getPreferredRuntime')
			.resolves({ runtimeId: 'r-1' } as any);
		const select = sandbox.stub(positron.runtime, 'selectLanguageRuntime').resolves();
		sandbox.stub(sessionModule, 'checkInstalled').resolves(true);

		await renvInit();

		assert.strictEqual(select.calledOnceWith('r-1'), true);
		assert.strictEqual(execute.calledOnce, true);
	});

	test('never calls checkInstalled before a session exists', async () => {
		// checkInstalled throws without a session, which is how the pre-hardening
		// command produced a misleading "Cannot check install status" error.
		const foreground = sandbox.stub(positron.runtime, 'getForegroundSession');
		foreground.onFirstCall().resolves(undefined);
		foreground.resolves(fakeSession as any);
		sandbox.stub(positron.runtime, 'getPreferredRuntime')
			.resolves({ runtimeId: 'r-1' } as any);
		const select = sandbox.stub(positron.runtime, 'selectLanguageRuntime').resolves();
		const checkInstalled = sandbox.stub(sessionModule, 'checkInstalled').resolves(true);

		await renvInit();

		assert.ok(checkInstalled.calledAfter(select), 'checkInstalled must follow session startup');
	});

	test('throws a clear error when there is no R to start', async () => {
		sandbox.stub(positron.runtime, 'getForegroundSession').resolves(undefined);
		sandbox.stub(positron.runtime, 'getPreferredRuntime').resolves(undefined);

		await assert.rejects(renvInit(), /no R installation/i);
	});

	test('throws when the session never becomes available', async () => {
		sandbox.stub(positron.runtime, 'getForegroundSession').resolves(undefined);
		sandbox.stub(positron.runtime, 'getPreferredRuntime')
			.resolves({ runtimeId: 'r-1' } as any);
		sandbox.stub(positron.runtime, 'selectLanguageRuntime').resolves();

		await assert.rejects(renvInit(), /did not start/i);
	});

	test('returns quietly when the user declines to install renv', async () => {
		sandbox.stub(positron.runtime, 'getForegroundSession').resolves(fakeSession as any);
		sandbox.stub(sessionModule, 'checkInstalled').resolves(false);

		await renvInit();

		assert.strictEqual(execute.called, false);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test-extension -- -l positron-r --grep "renvInit"`

Expected: FAIL, `renvInit` is not exported from `../commands`.

- [ ] **Step 3: Write the implementation**

In `commands.ts`, replace the whole `r.renvInit` registration (lines 236-251) with a thin delegation:

```ts
		// Command used to initialize a new folder with renv
		vscode.commands.registerCommand('r.renvInit', async () => renvInit()),
```

Then add this exported function near the bottom of `commands.ts`, beside the other helpers:

```ts
/** How long to wait for a freshly started session to become the foreground session. */
const RENV_SESSION_TIMEOUT_MS = 30_000;
const RENV_SESSION_POLL_MS = 250;

/**
 * Initializes renv in the current project, starting an R session first if none
 * is running.
 *
 * Ordering matters: `checkInstalled` resolves its own session and throws when
 * there is none, so it must not run until a session exists.
 */
export async function renvInit(): Promise<void> {
	let session = await positron.runtime.getForegroundSession();

	if (!session) {
		const preferred = await positron.runtime.getPreferredRuntime('r');
		if (!preferred) {
			throw new Error('Cannot initialize renv: no R installation is available to start.');
		}
		await positron.runtime.selectLanguageRuntime(preferred.runtimeId);

		// selectLanguageRuntime resolves through a bare proxy call and does not
		// promise the session is ready, so poll rather than execute into a race.
		const deadline = Date.now() + RENV_SESSION_TIMEOUT_MS;
		while (!session && Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, RENV_SESSION_POLL_MS));
			session = await positron.runtime.getForegroundSession();
		}
		if (!session) {
			throw new Error('Cannot initialize renv: the R session did not start in time.');
		}
	}

	// Ensure renv is installed; this prompts the user to install if it is not
	// already. If the user declines, renv::init() is not called.
	const isInstalled = await checkInstalled('renv', MINIMUM_RENV_VERSION);
	if (!isInstalled) {
		LOGGER.info('[r.renvInit] renv is not installed; skipping renv::init()');
		return;
	}

	session.execute(
		`renv::init()`,
		generateDirectInjectionId(),
		positron.RuntimeCodeExecutionMode.Interactive,
		positron.RuntimeErrorBehavior.Continue
	);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test-extension -- -l positron-r --grep "renvInit"`

Expected: PASS, 6 tests.

If the `checkInstalled` stub does not take effect, it is because `commands.ts` imports the binding directly. Import the module namespace in `commands.ts` (`import * as sessionModule from './session'`) and call `sessionModule.checkInstalled(...)` so sinon can intercept it.

- [ ] **Step 5: Verify the whole extension suite still passes**

Run: `npm run test-extension -- -l positron-r`

Expected: PASS. This catches any regression in the New Folder flow's caller.

- [ ] **Step 6: Commit**

```bash
git add extensions/positron-r/src/commands.ts extensions/positron-r/src/test/renvInit.unit.test.ts
git commit -m "fix(r): start an R session in renvInit when none is running"
```

---

## Verification before opening the PR

- [ ] `npm run test-extension -- -l positron-r` passes in full
- [ ] `npm run build-check` reports no errors
- [ ] `npm run precommit` passes on all staged files
- [ ] The palette command produces a well-formed JSON block on a healthy machine
- [ ] `dedicatedEnvironment` fails on a folder with no `renv.lock`, and its fix button starts a session and runs `renv::init()` from a cold workbench

Use the `positron-pr-helper` skill for the PR body. Tag e2e coverage with `@:interpreter`, matching the Python health check PR.
