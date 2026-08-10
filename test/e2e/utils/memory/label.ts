/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
 * The token of a command line that sits inside some extension's directory.
 *
 * Three dir names are in play: `bundled/extensions/` for what ships with the
 * build, `~/.positron-server/extensions/` for what the user installed, and
 * `extensions-dir/` for the throwaway dir the e2e harness passes. Missing the
 * last one would leave every bootstrap extension unnamed in exactly the runs
 * this harness produces.
 */
const EXTENSION_PATH = /\/extensions(?:-dir)?\/([^/\s]+)\//;

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
	[/^electron-nodejs\b/, 'extension_child'],
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
	[/\bipykernel_launcher\b|\/ark\b/, 'kernel'],
	// Quarto ships its server under `out/lsp/`, which neither spells
	// `language-server` nor ends in `ServerMain`, so the name rules miss it and it
	// would otherwise fall through to the extension fallback below.
	[/language-server|\/lsp\//, 'language_server'],
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
