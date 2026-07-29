/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DataConnectionNode, reloadKey } from '../../browser/classes/dataConnectionsTreeInstance.js';
import { IDataConnectionNodeDTO } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';
import { IDataConnectionHandle, IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';

function createProfile(overrides: Partial<IDataConnectionProfile> = {}): IDataConnectionProfile {
	return {
		id: 'conn-1',
		driverMetadata: {
			id: 'test-driver',
			name: 'Test Driver',
			iconSvg: '',
			supportedLanguageIds: ['python', 'r'],
		},
		connectionName: 'My Connection',
		mechanismId: 'test-mechanism',
		parameterValues: { host: 'localhost' },
		...overrides,
	};
}

function createHandle(handle: number): IDataConnectionHandle {
	return stubInterface<IDataConnectionHandle>({ handle });
}

/**
 * An entry node for the given profile.
 */
function entryNode(profile: IDataConnectionProfile): DataConnectionNode {
	return { kind: 'entry', entry: { profile } };
}

/**
 * A DTO node. nodeHandle defaults to a throwaway value because the whole point of reloadKey is
 * that it doesn't participate -- tests that care pass it explicitly.
 */
function dtoNode(
	dto: Partial<IDataConnectionNodeDTO> & Pick<IDataConnectionNodeDTO, 'kind' | 'name'>,
	handle = 1
): DataConnectionNode {
	return {
		kind: 'dto',
		dto: { nodeHandle: 99, hasGetChildren: true, hasPreview: false, ...dto },
		handle: createHandle(handle),
	};
}

describe('dataConnectionsTreeInstance reloadKey', () => {
	it('keys an entry on its profile id, so a renamed connection keeps its identity', () => {
		const before = reloadKey(entryNode(createProfile({ connectionName: 'Sales DB' })));
		const after = reloadKey(entryNode(createProfile({ connectionName: 'Sales Warehouse' })));

		expect({ before, after, stable: before === after }).toMatchInlineSnapshot(`
			{
			  "after": "entry:conn-1",
			  "before": "entry:conn-1",
			  "stable": true,
			}
		`);
	});

	it('gives different profiles different keys', () => {
		expect(reloadKey(entryNode(createProfile({ id: 'conn-1' }))))
			.not.toBe(reloadKey(entryNode(createProfile({ id: 'conn-2' }))));
	});

	// The property the whole reload/re-expand path depends on: node handles are minted from a
	// counter on every fetch, so the same logical node comes back with a different handle (and
	// therefore a different node id) and must still match its pre-reload counterpart.
	it('keys a DTO on kind and name, ignoring the per-fetch node handle', () => {
		const before = reloadKey(dtoNode({ kind: 'schema', name: 'public', nodeHandle: 7 }));
		const after = reloadKey(dtoNode({ kind: 'schema', name: 'public', nodeHandle: 412 }));

		expect({ before, after, stable: before === after }).toMatchInlineSnapshot(`
			{
			  "after": "["schema","public"]",
			  "before": "["schema","public"]",
			  "stable": true,
			}
		`);
	});

	it('ignores the originating connection handle, since matching is per sibling level', () => {
		expect(reloadKey(dtoNode({ kind: 'table', name: 'users' }, 1)))
			.toBe(reloadKey(dtoNode({ kind: 'table', name: 'users' }, 2)));
	});

	it('distinguishes a name from a kind, and both from the other DTO fields', () => {
		const keys = [
			reloadKey(dtoNode({ kind: 'table', name: 'users' })),
			reloadKey(dtoNode({ kind: 'view', name: 'users' })),
			reloadKey(dtoNode({ kind: 'table', name: 'orders' })),
			// dataType / isPrimaryKey / hasPreview are not part of the identity: a column whose
			// type changed between fetches is still the same column.
			reloadKey(dtoNode({ kind: 'table', name: 'users', dataType: 'int', isPrimaryKey: true, hasPreview: true })),
		];

		expect(keys).toMatchInlineSnapshot(`
			[
			  "["table","users"]",
			  "["view","users"]",
			  "["table","orders"]",
			  "["table","users"]",
			]
		`);
	});

	// The reason the pair is JSON-encoded rather than concatenated. Under a naive \`\${kind}:\${name}\`
	// both of these pairs would render as 'a:b:c' and the tree would restore the wrong sibling.
	it('does not collide when a name contains the separator', () => {
		expect(reloadKey(dtoNode({ kind: 'a', name: 'b:c' })))
			.not.toBe(reloadKey(dtoNode({ kind: 'a:b', name: 'c' })));
	});

	it('does not collide when a name contains quotes or brackets', () => {
		const keys = [
			reloadKey(dtoNode({ kind: 'table', name: '","' })),
			reloadKey(dtoNode({ kind: 'table', name: '' })),
			reloadKey(dtoNode({ kind: 'table', name: '"]' })),
		];

		expect(new Set(keys).size).toBe(keys.length);
	});

	it('never collides with an entry key', () => {
		// An entry key is 'entry:<id>'; a DTO key is a JSON array, so the two spaces can't meet
		// even for a DTO deliberately named to look like an entry.
		expect(reloadKey(dtoNode({ kind: 'entry', name: 'conn-1' })))
			.not.toBe(reloadKey(entryNode(createProfile({ id: 'conn-1' }))));
	});
});
