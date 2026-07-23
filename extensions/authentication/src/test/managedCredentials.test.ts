/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { hasManagedCredentials, SNOWFLAKE_MANAGED_CREDENTIALS } from '../managedCredentials';

suite('hasManagedCredentials (env-var)', () => {
	const originalSnowflakeHome = process.env.SNOWFLAKE_HOME;
	let getConfigurationStub: sinon.SinonStub;

	setup(() => {
		delete process.env.SNOWFLAKE_HOME;
		getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration');
	});

	teardown(() => {
		if (originalSnowflakeHome === undefined) {
			delete process.env.SNOWFLAKE_HOME;
		} else {
			process.env.SNOWFLAKE_HOME = originalSnowflakeHome;
		}
		sinon.restore();
	});

	test('settings fallback no longer satisfies managed-credential discovery', () => {
		getConfigurationStub.returns({
			get: sinon.stub().returns({ SNOWFLAKE_HOME: '/opt/posit-workbench/sf' }),
		});

		assert.strictEqual(hasManagedCredentials(SNOWFLAKE_MANAGED_CREDENTIALS, true), false);
	});

	test('env var still satisfies discovery', () => {
		process.env.SNOWFLAKE_HOME = '/opt/posit-workbench/snowflake';

		assert.strictEqual(hasManagedCredentials(SNOWFLAKE_MANAGED_CREDENTIALS, true), true);
	});
});
