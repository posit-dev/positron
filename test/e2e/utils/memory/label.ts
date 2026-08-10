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
