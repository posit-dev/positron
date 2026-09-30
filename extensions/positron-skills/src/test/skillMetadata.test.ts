/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/** Longest skill description the skill loader accepts; longer ones are rejected. */
const MAX_DESCRIPTION_LENGTH = 1024;

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

/**
 * The description of a `SKILL.md` file as Posit Assistant's skill loader
 * measures it: a block scalar's raw lines joined with newlines, indentation
 * included. That is longer than the YAML value, which strips the indentation.
 */
function rawDescription(file: string): string {
	const content = fs.readFileSync(file, 'utf8');
	// CRLF-tolerant: with core.autocrlf, a Windows checkout's working copies
	// carry \r\n, and a \n-only match reports every manifest as frontmatterless.
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	assert.ok(match, `${file} has no frontmatter`);
	const lines = match[1].split(/\r?\n/);
	const start = lines.findIndex(line => line.startsWith('description:'));
	assert.ok(start >= 0, `${file} has no description`);
	const value = lines[start].slice('description:'.length).trim();
	if (value && value !== '>' && value !== '|') {
		return value;
	}
	const block: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (/^\S/.test(line)) {
			break;
		}
		if (line.trim()) {
			block.push(line);
		}
	}
	return block.join('\n').trim();
}

suite('skill manifests', () => {
	for (const file of skillManifests(TEMPLATES_DIR)) {
		const name = path.relative(TEMPLATES_DIR, file);
		test(`${name} description is at most ${MAX_DESCRIPTION_LENGTH} characters`, () => {
			const description = rawDescription(file);
			assert.ok(
				description.length <= MAX_DESCRIPTION_LENGTH,
				`description is ${description.length} characters; the limit is ${MAX_DESCRIPTION_LENGTH}`,
			);
		});
	}
});
