/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { MemoryLane } from './lanes.js';
import { ProcessRole } from './types.js';

/**
 * Reduce a command line to a stable name.
 *
 * `--status` reports processes it could not name by their entire command line,
 * which carries absolute paths, version numbers, and pids
 * (`--clientProcessId=4242`). Left raw, one process produces a different name on
 * every launch, and three things break at once: the unlabeled count inflates, the
 * dashboard's group-by explodes in cardinality, and the baseline diff reports the
 * same process as newly appeared every single night.
 *
 * Keeps the first two non-flag tokens as basenames plus flag names without their
 * values, which distinguishes these processes without carrying anything that
 * changes between launches. A real CI run had one bundled language server under
 * three names in three launches, and `ruff` under two.
 */
export function normalizeProcessName(name: string): string {
	// Positron's own names never begin with a path, and window titles can contain
	// anything, so only rewrite what is unambiguously a command line.
	if (!name.startsWith('/')) {
		return name;
	}

	const basename = (token: string): string =>
		(token.split('/').pop() || token).replace(/-\d+(\.\d+)+.*$/, '');

	const words: string[] = [];
	const flags: string[] = [];
	for (const token of name.split(/\s+/).filter(Boolean)) {
		if (token.startsWith('-')) {
			flags.push(token.split('=')[0]);
		} else if (words.length < 2) {
			words.push(basename(token));
		}
	}
	return [...words, ...flags].join(' ');
}

/** Version suffixes an extension dir and an executable both carry. */
const VERSION_SUFFIX = /-\d+(\.\d+)+.*$/;

/**
 * Strips the version from an extension directory name: `air-vscode-0.4.1` ->
 * `air-vscode`.
 *
 * Shared rather than reimplemented because heap attribution strips a directory
 * name on one side of a lookup whose other side is built in extensions.ts. A
 * second copy that drifted would miss silently and degrade real extension ids
 * back to directory names.
 */
export function stripVersionSuffix(directory: string): string {
	return directory.replace(VERSION_SUFFIX, '');
}

/**
 * The token of a command line that sits inside some extension's directory.
 *
 * Any segment beginning `extensions`, rather than a list of known names. The
 * build uses `bundled/extensions/`, a user install uses
 * `~/.positron-server/extensions/`, and the e2e harness passes a throwaway
 * `extensions-dir/` which the memory scenario further varies to
 * `extensions-dir-memory/`. A first attempt enumerated the first two and shipped
 * a labeler that silently missed every extension in exactly the runs this
 * harness produces.
 */
const EXTENSION_PATH = /\/extensions[^/]*\/([^/\s]+)\//;

/**
 * Name a process after the extension that spawned it.
 *
 * The eagerly started servers are the largest single processes in an idle tree
 * (Quarto's language server and the duckdb worker are ~100mb and ~86mb), and
 * every one of them is spawned by `node` from inside an extension directory. So
 * `--status` cannot name them, and their whole command line is what gets
 * reported instead. The result is bytes attributed to a role but to no culprit.
 *
 * The extension id is already in the path, so take it from there. The executable
 * is appended only when it says something the id does not: `charliermarsh.ruff`
 * running `ruff` gains nothing from `(ruff)`, but `positron-python` running `pet`
 * does.
 *
 * This is deliberately display-only. It sets `processName`, never `processRole`,
 * so a mistake here cannot re-bucket the dashboard's grouping key. See the note
 * on the role fallback below.
 */
export function deriveExtensionName(cmd: string): string | undefined {
	const token = cmd.split(/\s+/).find(part => EXTENSION_PATH.test(part));
	if (!token) {
		return undefined;
	}

	const id = token.match(EXTENSION_PATH)![1].replace(VERSION_SUFFIX, '');
	const exe = (token.split('/').pop() || '')
		.replace(/\.(js|cjs|mjs|sh)$/, '')
		.replace(VERSION_SUFFIX, '');

	// Substring either way: the id may name the executable (`posit.air-vscode`
	// running `air`) or the executable may name the id.
	const redundant = !exe || id.includes(exe) || exe.includes(id);
	return redundant ? id : `${id} (${exe})`;
}

/**
 * Ordered rules matched against the name Positron reports via `--status`, after
 * normalization. First match wins, so put more specific patterns first.
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
	// Chromium's fork helper. Small and always present in pairs, so leaving it
	// unlabeled means a permanent unattributed row in every report.
	[/^zygote$/, 'zygote'],
	// Bundled servers: json/html/css ship as `<lang>ServerMain`, TypeScript as
	// `tsserver`. Matching only `language-server` missed all of them, because the
	// extension is named `json-language-features`, not `-server`.
	[/ServerMain\b|language-server|language-features|tsserver|^ruff\b/, 'language_server'],
	// python-env-tools, spawned by positron-python to enumerate interpreters.
	[/^pet\b/, 'extension_child'],
	// A terminal's shell, spawned by pty-host. Its own role rather than folded
	// into pty_host, so terminal overhead stays separable from shells the user
	// or shell integration started.
	[/^bash\b|^zsh\b|^fish\b|shellIntegration/, 'shell'],
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
	[/positron_language_server\.py\b|\/ark\b/, 'kernel'],
	// Quarto ships its server under `out/lsp/`, which neither spells
	// `language-server` nor ends in `ServerMain`, so the name rules miss it and it
	// would otherwise fall through to the extension fallback below.
	[/language-server|\/lsp\//, 'language_server'],
];

/**
 * Names Positron reports that identify a wrapper rather than a process.
 *
 * `electron-nodejs (lsp.js)` says a node process is running `lsp.js`; it does
 * not say whose. CI reported Quarto's language server under exactly that name,
 * which put it in `extension_child` and made the argv rules unreachable. These
 * are consulted only after argv has had its turn, so a generic name can no
 * longer outrank a specific identification.
 */
const GENERIC_NAME_RULES: [RegExp, ProcessRole][] = [
	[/^electron-nodejs\b/, 'extension_child'],
];

/** Whether a name Positron reported identifies only a wrapper. */
export function isGenericName(positronName: string): boolean {
	return GENERIC_NAME_RULES.some(([pattern]) => pattern.test(positronName));
}

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

	const byGenericName = input.positronName ? firstMatch(GENERIC_NAME_RULES, input.positronName) : undefined;
	if (byGenericName) {
		return { role: byGenericName, labeled };
	}

	// Last, and it must stay last. Everything an extension spawns lives under an
	// extension directory, including the language servers the rules above claim,
	// so moving this earlier would swallow them and silently re-bucket the
	// dashboard's history. It exists only to catch what nothing else did: the next
	// duckdb worker becomes a named `extension_child` instead of a mystery.
	//
	// This is the one inference in role resolution. It infers a category, never a
	// specific role, so getting it wrong costs a coarse bucket rather than a wrong
	// answer. Anything more specific belongs in the rule lists above, as a row.
	if (deriveExtensionName(input.cmd)) {
		return { role: 'extension_child', labeled };
	}

	return { role: 'unlabeled', labeled };
}

/**
 * Whether the namedShare attribution gate (memory-scenario.ts) applies to a
 * lane. `--status` is inherently an Electron IPC call: the CLI spawns a child
 * Electron main to query an already-running instance (positron-status.ts). The
 * server lane has no such instance to ask, so every process is unlabeled by
 * construction there, and the gate would fail every run regardless of how good
 * attribution actually is.
 *
 * The lane is not left ungated: `resolveRole` above classifies by argv and by
 * the extension directory a process was spawned from, with no dependence on
 * `positronName`, so the unlabeledBytes gate stays lane-agnostic and still
 * catches a genuinely unattributable tree in the server lane.
 */
export function namedShareGateApplies(lane: MemoryLane): boolean {
	return lane !== 'server';
}
