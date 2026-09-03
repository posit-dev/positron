/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { expandTemplate } from '../templateExpander';

/** Longest skill description the skill loader accepts; longer ones are rejected. */
const MAX_DESCRIPTION_LENGTH = 1024;

/**
 * Every flag combination the generator can emit. Descriptions may hold
 * conditional blocks, so the limit must hold for each expansion, not for the
 * raw template text (whose marker syntax inflates the count). `pwb` implies
 * `remote` (a Workbench session is always remote), so that pair has three
 * combinations rather than four; `shiny_agent_metadata` is independent of both.
 */
const FLAG_COMBINATIONS = [
	{ pwb: false, remote: false },
	{ pwb: false, remote: true },
	{ pwb: true, remote: true },
].flatMap(flags => [
	{ ...flags, shiny_agent_metadata: false },
	{ ...flags, shiny_agent_metadata: true },
]);

/** The templates directory, resolved from this compiled test's location in `out/test`. */
const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

/** Every `SKILL.md` under the templates directory, as absolute paths. */
function skillManifests(dir: string): string[] {
	const files: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...skillManifests(full));
		} else if (entry.name === 'SKILL.md') {
			files.push(full);
		}
	}
	return files;
}

/** Parse the YAML frontmatter of a `SKILL.md` file. */
function frontmatter(file: string): { description?: string } {
	const content = fs.readFileSync(file, 'utf8');
	// CRLF-tolerant: with core.autocrlf, a Windows checkout's working copies
	// carry \r\n, and a \n-only match reports every manifest as frontmatterless.
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	assert.ok(match, `${file} has no frontmatter`);
	return yaml.load(match[1]) as { description?: string };
}

suite('skill manifests', () => {
	for (const file of skillManifests(TEMPLATES_DIR)) {
		const name = path.relative(TEMPLATES_DIR, file);
		test(`${name} description is at most ${MAX_DESCRIPTION_LENGTH} characters in every expansion`, () => {
			const description = frontmatter(file).description?.trim() ?? '';
			for (const flags of FLAG_COMBINATIONS) {
				const expanded = expandTemplate(description, new Map(), flags);
				assert.deepStrictEqual(expanded.unbalanced, [], `description has unbalanced conditionals`);
				assert.deepStrictEqual(expanded.unknownFlags, [], `description names unknown flags`);
				assert.deepStrictEqual(expanded.sameFlagNesting, [], `description nests a flag inside itself`);
				assert.ok(
					expanded.text.length <= MAX_DESCRIPTION_LENGTH,
					`description is ${expanded.text.length} characters with flags ` +
					`${JSON.stringify(flags)}; the limit is ${MAX_DESCRIPTION_LENGTH}`,
				);
			}
		});
	}
});
