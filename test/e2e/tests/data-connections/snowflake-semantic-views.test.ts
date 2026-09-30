/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { createBrowserLaunchShim } from '../../utils/browserLaunchShim';
import { completeSnowflakeSdkOAuth } from '../../utils/snowflakeOAuth';

// Intercepts the browser launch snowflake-sdk makes during External Browser sign-in. Created at
// module scope because `test.use({ extraEnv })` below is evaluated when this file is collected.
const shim = createBrowserLaunchShim();

test.use({
	suiteId: __filename,
	enableDataConnections: true,
	extraEnv: shim.env,
});

const connectionName = 'snowflake';

// The warehouse queries run on. GET_DDL, which fills the Definition tab, is a SELECT and needs one.
const warehouse = 'CI_WH';

// A semantic view built from a Cortex Analyst model in the dev account. Its shape is what the tree
// and the details editor are checked against: the T_DATA_LOG logical table carries the LOG_DT time
// dimension, and it is only known to be a time dimension from the model's extension.
const database = 'DEMO_CHAOS_DB';
const schema = 'ERP_DUMP';
const semanticView = 'CHAOS_MODEL';
const logicalTable = 'T_DATA_LOG';
const timeDimension = 'LOG_DT';

// Desktop only, and not Windows, for the same reasons as snowflake.test.ts: the browser launch shim
// only reaches the extension host on the Electron launch path, and cannot intercept on Windows.
test.describe('Data Connections - Snowflake Semantic Views', {
	tag: [tags.CONNECTIONS]
}, () => {

	test.beforeAll(async function ({ app }) {
		const account = process.env.SNOWFLAKE_ACCOUNT || '';
		const otpSecret = process.env.IDE_SERVICE_ACCOUNT_OTP_SECRET || '';
		test.skip(!account || !otpSecret, 'Snowflake test credentials not configured (SNOWFLAKE_ACCOUNT / IDE_SERVICE_ACCOUNT_OTP_SECRET unset)');

		// Covers the interactive sign-in plus a warehouse that may be resuming from idle.
		test.setTimeout(900_000);

		const { dataConnections } = app.workbench;
		dataConnections.actionTimeout = 420_000;

		await dataConnections.openDataConnectionsView();
		await dataConnections.clickAddConnection();
		await dataConnections.selectProvider('Snowflake');
		await dataConnections.selectConnectionMechanism('External Browser');
		await dataConnections.fillConnectionInputs([
			['Connection Name', connectionName],
			['Account', account],
			[/^Warehouse/, warehouse],
		]);
		await dataConnections.save();
		await dataConnections.expectConnectionInTree(connectionName);

		await completeSnowflakeSdkOAuth(
			shim,
			() => dataConnections.expandConnection(connectionName),
			{ logger: app.code.logger },
		);

		await test.step('Expand the tree down to the semantic view', async () => {
			await dataConnections.expandNode('Databases');
			await dataConnections.expandNode(database, 'database');
			await dataConnections.expandNode('Schemas');
			await dataConnections.expandNode(schema, 'schema');
			await dataConnections.expandNode('Semantic Views');
			await dataConnections.expandNode(semanticView, 'semantic-view');
		});

		dataConnections.actionTimeout = 60_000;
	});

	// Each test opens a details tab; close it so the next test proves it opened its own.
	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test.afterAll(async function () {
		shim.dispose();
	});

	test('Verify a semantic view lists its logical tables and their members', async function ({ app }) {
		const { dataConnections } = app.workbench;

		await dataConnections.expectNodeVisible('Derived Metrics');
		await dataConnections.expectNodeVisible('Relationships');

		await dataConnections.expandNode('Logical Tables');
		await dataConnections.expandNode(logicalTable, 'logical-table');
		await dataConnections.expandNode('Time Dimensions');
		await dataConnections.expectNodeVisible(timeDimension, 'time-dimension');
	});

	test('Verify a semantic view opens a details editor with its overview and definition', async function ({ app }) {
		const { dataConnections } = app.workbench;

		await dataConnections.doubleClickNode(semanticView, 'semantic-view');
		await dataConnections.expectDetailsOpen(semanticView, 'Semantic view');
		await dataConnections.expectDetailsToContain(logicalTable);

		await dataConnections.selectDetailsTab('Definition');
		await dataConnections.expectDetailsCodeToContain(/semantic view/i);
	});

	test('Verify a member opens its details on a single click', async function ({ app }) {
		const { dataConnections } = app.workbench;

		await dataConnections.expandNode('Logical Tables');
		await dataConnections.expandNode(logicalTable, 'logical-table');
		await dataConnections.expandNode('Time Dimensions');

		await dataConnections.clickNode(timeDimension, 'time-dimension');
		await dataConnections.expectDetailsOpen(timeDimension, 'Time dimension');
		await dataConnections.expectDetailsToContain(`${logicalTable}.${timeDimension}`);
	});
});
