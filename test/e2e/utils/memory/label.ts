/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
