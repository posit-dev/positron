/* eslint-disable header/header */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { IProcessEnvironment } from '../../../base/common/platform.js';
import { restoreServerValues, WORKBENCH_ENFORCED_ENV_VARS } from '../../node/extensionHostConnection.js';

suite('restoreServerValues', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('replaces shell values with the server\'s, and keeps the shell value if the server has none', () => {
		const env: IProcessEnvironment = { OTHER: 'shell' };
		for (const name of WORKBENCH_ENFORCED_ENV_VARS) {
			env[name] = 'shell';
		}
		const serverEnv: IProcessEnvironment = {
			POSITRON_ENFORCED_SETTINGS: '{"a":1}',
			POSIT_AI_PROVIDERS_ENFORCED: '{"b":2}',
		};

		restoreServerValues(env, serverEnv, WORKBENCH_ENFORCED_ENV_VARS);

		assert.deepStrictEqual(env, {
			OTHER: 'shell',
			POSITRON_ENFORCED_SETTINGS: '{"a":1}',
			POSIT_AI_PROVIDERS_ENFORCED: '{"b":2}',
			POSIT_ASSISTANT_SETTINGS_ENFORCED: 'shell',
		});
	});
});
