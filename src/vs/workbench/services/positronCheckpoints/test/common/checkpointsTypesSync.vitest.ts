/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable local/code-import-patterns -- this test reads repository source files with Node APIs. */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * The checkpoints data types exist in three copies: the engine's `types.ts`, the core
 * `checkpointsTypes.ts`, and `namespace checkpoints` in `positron.d.ts`. The compiler checks that
 * values pass between them, but a field, an engine method, or a union member that one copy lacks
 * can still go unnoticed (an optional field missing from one copy compiles). This test compares
 * the engine method names, the fields of each data interface (name, optionality, and type), and
 * the members of each union alias. The core copy names its interfaces with an `I` prefix; the
 * comparison removes it.
 */

const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_FILE_DIR, '../../../../../../..');

const CORE_TYPES = path.join(REPO_ROOT, 'src/vs/workbench/services/positronCheckpoints/common/checkpointsTypes.ts');
const POSITRON_DTS = path.join(REPO_ROOT, 'src/positron-dts/positron.d.ts');
const ENGINE_TYPES = path.join(REPO_ROOT, 'extensions/positron-checkpoints/src/engine/types.ts');

const UNION_ALIASES = ['UnusualKind', 'OperationKind', 'OverlapKind', 'UnavailableReason', 'RejectedReason', 'ContentRef', 'DiffTarget', 'OverlapChoice', 'OperationResult'];

const DATA_INTERFACES = ['EngineState', 'Hunk', 'ChangedFile', 'ChangeSet', 'Chunk', 'Checkpoint', 'Overlap', 'Resolution', 'PathCollision', 'CollisionChoice', 'KeptFile', 'IncomingPreview'];

interface ITypesCopy {
	readonly name: string;
	readonly text: string;
	/** The name of the engine interface in this copy. */
	readonly engineInterface: string;
	/** The prefix of data interface names in this copy. */
	readonly interfacePrefix: string;
}

/** The `checkpoints` namespace of `positron.d.ts`, so names of other namespaces do not match. */
function checkpointsNamespace(text: string): string {
	const start = text.indexOf('namespace checkpoints {');
	expect(start).toBeGreaterThanOrEqual(0);
	const end = text.indexOf('\n\t}\n', start);
	expect(end).toBeGreaterThan(start);
	return text.slice(start, end);
}

/** `text` without comments, with each run of white space as one space, and without the core `I` prefix of type names. */
function normalize(text: string): string {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/.*$/gm, '')
		.replace(/\bI(?=[A-Z][a-z])/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Splits `text` at each `separator` character that is outside brackets and parentheses. */
function splitTopLevel(text: string, separators: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = '';
	for (let index = 0; index < text.length; index++) {
		const character = text[index];
		if ('{(<['.includes(character)) {
			depth++;
		} else if ('})]'.includes(character) || (character === '>' && text[index - 1] !== '=')) {
			depth--;
		}
		if (depth === 0 && separators.includes(character)) {
			parts.push(current);
			current = '';
		} else {
			current += character;
		}
	}
	parts.push(current);
	return parts.map(part => part.trim()).filter(part => part !== '');
}

/** The body of the interface `name`, between its braces, without comments. */
function interfaceBody(text: string, name: string): string {
	const match = new RegExp(`interface ${name} \\{`).exec(text);
	expect(match, `interface ${name}`).not.toBeNull();
	const start = match!.index + match![0].length;
	let depth = 1;
	let index = start;
	while (depth > 0 && index < text.length) {
		const character = text[index++];
		if (character === '{') {
			depth++;
		} else if (character === '}') {
			depth--;
		}
	}
	return normalize(text.slice(start, index - 1));
}

/** Each member of the interface `name` as `name: type` or `name?: type`, sorted. */
function interfaceFields(text: string, name: string): string[] {
	return splitTopLevel(interfaceBody(text, name), ';').map(member => member.replace(/^readonly /, '')).sort();
}

/** The member names of the interface `name`, sorted. */
function interfaceMemberNames(text: string, name: string): string[] {
	return interfaceFields(text, name).map(member => {
		const found = /^(?<member>[A-Za-z]\w*)/.exec(member);
		expect(found?.groups, `a member of ${name}: ${member}`).toBeDefined();
		return found!.groups!.member;
	});
}

/** The members of the union alias `name`, each normalized, sorted. */
function unionMembers(text: string, name: string): string[] {
	// The alias ends at the first `;` that ends a line not followed by another `|` member.
	const match = new RegExp(`type ${name} =(?<members>[\\s\\S]*?);[ \\t]*\\n(?![ \\t]*\\|)`).exec(text);
	expect(match?.groups, `type ${name}`).toBeDefined();
	return splitTopLevel(normalize(match!.groups!.members), '|').map(member => member.replace(/;? \}$/, ' }')).sort();
}

describe('checkpoints data types', () => {
	const copies: ITypesCopy[] = [
		{ name: 'types.ts', text: fs.readFileSync(ENGINE_TYPES, 'utf8'), engineInterface: 'CheckpointsEngine', interfacePrefix: '' },
		{ name: 'checkpointsTypes.ts', text: fs.readFileSync(CORE_TYPES, 'utf8'), engineInterface: 'ICheckpointsEngineProxy', interfacePrefix: 'I' },
		{ name: 'positron.d.ts', text: checkpointsNamespace(fs.readFileSync(POSITRON_DTS, 'utf8')), engineInterface: 'CheckpointsEngine', interfacePrefix: '' },
	];

	it('has the same engine methods in every copy', () => {
		const [reference, ...others] = copies;
		const expected = interfaceMemberNames(reference.text, reference.engineInterface);
		expect(expected).toContain('getState');
		for (const copy of others) {
			expect({ copy: copy.name, members: interfaceMemberNames(copy.text, copy.engineInterface) }).toEqual({ copy: copy.name, members: expected });
		}
	});

	it.each(DATA_INTERFACES)('has the same fields of %s in every copy', name => {
		const [reference, ...others] = copies;
		const expected = interfaceFields(reference.text, name);
		expect(expected.length).toBeGreaterThan(0);
		for (const copy of others) {
			expect({ copy: copy.name, fields: interfaceFields(copy.text, copy.interfacePrefix + name) }).toEqual({ copy: copy.name, fields: expected });
		}
	});

	it.each(UNION_ALIASES)('has the same members of %s in every copy', alias => {
		const [reference, ...others] = copies;
		const expected = unionMembers(reference.text, alias);
		expect(expected.length).toBeGreaterThan(1);
		for (const copy of others) {
			expect({ copy: copy.name, members: unionMembers(copy.text, alias) }).toEqual({ copy: copy.name, members: expected });
		}
	});

	it('reads every kind of OperationResult and DiffTarget', () => {
		// A check of the parser: each member of the two unions is one `{ kind: ... }` object.
		const kinds = (alias: string) => unionMembers(copies[0].text, alias).map(member => /^\{ kind: '(?<kind>[^']+)'/.exec(member)?.groups?.kind);
		expect(kinds('OperationResult').sort()).toEqual(['changes-moved', 'check-changed-checkpoint', 'check-failed', 'could-not-finish', 'done', 'inputs-changed', 'interrupted', 'overlaps', 'path-collisions', 'project-changed', 'rejected', 'unavailable']);
		expect(kinds('DiffTarget').sort()).toEqual(['change', 'checkpoint', 'incoming', 'overlap', 'pending', 'trees']);
	});
});
