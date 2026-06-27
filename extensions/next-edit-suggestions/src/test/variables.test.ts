/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as sinon from 'sinon';

import { getSessionVariables } from '../variables.js';

const session = {
	metadata: { sessionId: 's1' },
	runtimeMetadata: { languageId: 'python' },
};

function variable(name: string, type: string, hasChildren = false) {
	return { display_name: name, display_type: type, has_children: hasChildren, access_key: name };
}

suite('variables / getSessionVariables', () => {
	let getActiveSessions: sinon.SinonStub;
	let getSessionVars: sinon.SinonStub;

	setup(() => {
		getActiveSessions = sinon.stub(positron.runtime, 'getActiveSessions');
		getSessionVars = sinon.stub(positron.runtime, 'getSessionVariables');
	});

	teardown(() => {
		sinon.restore();
	});

	test('returns an empty array when there are no active sessions', async () => {
		getActiveSessions.resolves([]);

		assert.deepStrictEqual(await getSessionVariables(), []);
	});

	test('maps a session to a language-tagged variables context', async () => {
		getActiveSessions.resolves([session]);
		getSessionVars.resolves([[variable('y', 'int'), variable('z', 'str')]]);

		const result = await getSessionVariables();

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].languageId, 'python');
		assert.deepStrictEqual(result[0].variables, [
			{ name: 'y', type: 'int' },
			{ name: 'z', type: 'str' },
		]);
	});

	test('prioritizes referenced variables and expands their children', async () => {
		getActiveSessions.resolves([session]);
		getSessionVars.callsFake(async (_sessionId: string, accessKeys?: string[][]) => {
			if (accessKeys) {
				// Children of the expanded "data" variable.
				return [[variable('col', 'int')]];
			}
			return [[variable('y', 'int'), variable('data', 'dict', true)]];
		});

		const result = await getSessionVariables(new Set(['data']));

		// Referenced "data" comes first despite being listed second.
		assert.strictEqual(result[0].variables[0].name, 'data');
		assert.deepStrictEqual(result[0].variables[0].children, [{ name: 'col', type: 'int' }]);
		// Unreferenced "y" is not expanded.
		assert.deepStrictEqual(result[0].variables[1], { name: 'y', type: 'int' });
	});

	test('respects the per-session variable limit', async () => {
		getActiveSessions.resolves([session]);
		getSessionVars.resolves([[variable('a', 'int'), variable('b', 'int'), variable('c', 'int')]]);

		const result = await getSessionVariables(new Set(), 1);

		assert.strictEqual(result[0].variables.length, 1);
	});

	test('drops a session whose variables cannot be retrieved', async () => {
		getActiveSessions.resolves([session]);
		getSessionVars.rejects(new Error('session gone'));

		assert.deepStrictEqual(await getSessionVariables(), []);
	});
});
