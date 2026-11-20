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
 * values pass between them, but an engine method or a union member that one copy lacks can still
 * go unnoticed. This test compares the engine method names and the members of each union alias.
 */

const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_FILE_DIR, '../../../../../../..');

const CORE_TYPES = path.join(REPO_ROOT, 'src/vs/workbench/services/positronCheckpoints/common/checkpointsTypes.ts');
const POSITRON_DTS = path.join(REPO_ROOT, 'src/positron-dts/positron.d.ts');
const ENGINE_TYPES = path.join(REPO_ROOT, 'extensions/positron-checkpoints/src/engine/types.ts');

const UNION_ALIASES = ['UnusualKind', 'OperationKind', 'OverlapKind', 'UnavailableReason', 'RejectedReason'];

interface ITypesCopy {
	readonly name: string;
	readonly text: string;
	readonly engineInterface: string;
}

function readCopy(name: string, file: string, engineInterface: string): ITypesCopy {
	return { name, text: fs.readFileSync(file, 'utf8'), engineInterface };
}

/** The `checkpoints` namespace of `positron.d.ts`, so names of other namespaces do not match. */
function checkpointsNamespace(text: string): string {
	const start = text.indexOf('namespace checkpoints {');
	expect(start).toBeGreaterThanOrEqual(0);
	const end = text.indexOf('\n\t}\n', start);
	expect(end).toBeGreaterThan(start);
	return text.slice(start, end);
}

/** The member names of the interface `name`: each line in its body that starts with a name and then `(` or `:`. */
function interfaceMembers(text: string, name: string): string[] {
	const match = new RegExp(`interface ${name} \\{(?<body>[\\s\\S]*?)\\n\\t*\\}`).exec(text);
	expect(match?.groups, `interface ${name}`).toBeDefined();
	const members = new Set<string>();
	for (const line of match!.groups!.body.split('\n')) {
		const member = /^\s*(?:readonly\s+)?(?<member>[A-Za-z]\w*)\s*[(:]/.exec(line);
		if (member?.groups) {
			members.add(member.groups.member);
		}
	}
	return [...members].sort();
}

/** The string literal members of the one-line union alias `name`. */
function unionMembers(text: string, name: string): string[] {
	const match = new RegExp(`type ${name} = (?<members>[^;]+);`).exec(text);
	expect(match?.groups, `type ${name}`).toBeDefined();
	return match!.groups!.members.split('|').map(member => member.trim()).sort();
}

describe('checkpoints data types', () => {
	const copies: ITypesCopy[] = [
		readCopy('checkpointsTypes.ts', CORE_TYPES, 'ICheckpointsEngineProxy'),
		{ ...readCopy('positron.d.ts', POSITRON_DTS, 'CheckpointsEngine'), text: checkpointsNamespace(fs.readFileSync(POSITRON_DTS, 'utf8')) },
	];
	// The engine file of a worktree that has not been joined with the engine branch is older than
	// the core copies. `getCheckpointFiles` appears only in the joined engine file, so the engine
	// copy is compared once that method is present; before that, the two core copies are compared.
	const engineText = fs.existsSync(ENGINE_TYPES) ? fs.readFileSync(ENGINE_TYPES, 'utf8') : '';
	if (engineText.includes('getCheckpointFiles')) {
		copies.unshift({ name: 'types.ts', text: engineText, engineInterface: 'CheckpointsEngine' });
	}

	it('has the same engine methods in every copy', () => {
		const [reference, ...others] = copies;
		const expected = interfaceMembers(reference.text, reference.engineInterface);
		expect(expected).toContain('getState');
		for (const copy of others) {
			expect({ copy: copy.name, members: interfaceMembers(copy.text, copy.engineInterface) }).toEqual({ copy: copy.name, members: expected });
		}
	});

	it.each(UNION_ALIASES)('has the same members of %s in every copy', alias => {
		const [reference, ...others] = copies;
		const expected = unionMembers(reference.text, alias);
		for (const copy of others) {
			expect({ copy: copy.name, members: unionMembers(copy.text, alias) }).toEqual({ copy: copy.name, members: expected });
		}
	});
});
