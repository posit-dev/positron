/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { secretValues } from './appEnv';

// Calls whose arguments Playwright (or our page objects) put in a step title.
const TITLED_CALL = /(?:\.fill|\.type|\.pressSequentially|\.insertText|\.fillConnectionInputs|\.fillConnectionsInputs|\.pasteCodeToConsole|\.typeToConsole)\(/g;
const ENV_READ = /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g;
const ENV_BINDING = /([A-Za-z_$][\w$]*)\s*(?::\s*[\w<>[\] |]+)?\s*\??=\s*process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g;

/** True for env names whose values the scrub and scan treat as secrets. */
export function isScannedSecretName(name: string): boolean {
	return secretValues({ [name]: 'fake-value-123456' }).length > 0;
}

function argumentText(source: string, openParen: number): string {
	let depth = 0;
	for (let i = openParen; i < source.length; i++) {
		if (source[i] === '(') {
			depth++;
		} else if (source[i] === ')' && --depth === 0) {
			return source.slice(openParen + 1, i);
		}
	}
	return source.slice(openParen + 1);
}

/**
 * Finds fill/type-style calls that pass a secret env var, directly or through a variable bound
 * from it in the same file. Returns one line per hit, e.g. `12: password`.
 */
export function findSecretTypingCalls(source: string): string[] {
	const tainted = new Set<string>();
	for (const m of source.matchAll(ENV_BINDING)) {
		if (isScannedSecretName(m[2] ?? m[3])) {
			tainted.add(m[1]);
		}
	}

	const hits: string[] = [];
	for (const m of source.matchAll(TITLED_CALL)) {
		const open = m.index! + m[0].length - 1;
		const args = argumentText(source, open);
		const line = source.slice(0, m.index).split('\n').length;
		for (const env of args.matchAll(ENV_READ)) {
			if (isScannedSecretName(env[1] ?? env[2])) {
				hits.push(`${line}: process.env.${env[1] ?? env[2]}`);
			}
		}
		for (const name of tainted) {
			if (new RegExp(`(?<![.\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(args)) {
				hits.push(`${line}: ${name}`);
			}
		}
	}
	return hits;
}
