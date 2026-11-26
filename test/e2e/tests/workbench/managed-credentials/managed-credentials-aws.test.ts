/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../../_test.setup';
import { AWS_MANAGED_ROLE_NAME } from '../../../pages/workbench/dashboard.page';

test.use({
	suiteId: __filename,
	managedCredentials: 'aws',
	// The role has no Bedrock access, and the error toast of the Bedrock provider covers the Save button.
	extraSettings: { 'positron.assistant.provider.amazonBedrock.enable': false },
});

// The private serverless workgroup the Redshift suite uses (tests/data-connections/redshift.test.ts).
const host = 'positron-redshift-dev-test.749683154838.us-east-2.redshift-serverless.amazonaws.com';
const database = 'flights';
const table = 'flights';

test.describe('Managed Credentials - AWS', {
	tag: [tags.WORKBENCH_AWS]
}, () => {
	// Checked in a terminal, not a console: interpreter discovery can outlast the first session of this user.
	test('Verify AWS_ROLE_ARN environment variable is set', async function ({ app }) {
		const { terminal } = app.workbench;
		await terminal.createTerminal();
		await terminal.runCommandInTerminal('echo "arn=$AWS_ROLE_ARN"');
		await terminal.waitForTerminalText(new RegExp(`arn=arn:aws:iam::\\d+:role/${AWS_MANAGED_ROLE_NAME}`));
	});

	test.describe('Data Connections', { tag: [tags.CONNECTIONS] }, () => {
		const connectionName = 'redshift-workbench-aws';
		let addedConnection: string | undefined;

		test.beforeEach(async function ({ app }) {
			// A serverless workgroup can cold-start on the first connect.
			test.setTimeout(300_000);
			app.workbench.dataConnections.actionTimeout = 120_000;
			addedConnection = undefined;
			await app.workbench.dataConnections.openDataConnectionsView();
		});

		test.afterEach(async function ({ app }) {
			const { dataConnections } = app.workbench;
			try {
				if (addedConnection) {
					await dataConnections.collapseConnection(addedConnection);
				}
			} finally {
				dataConnections.actionTimeout = undefined;
			}
		});

		test('AWS IAM connection with no profile lists the tables the role can read', async function ({ app }) {
			const { dataConnections } = app.workbench;

			await dataConnections.clickAddConnection();
			await dataConnections.selectProvider('Redshift');
			await dataConnections.selectConnectionMechanism('AWS IAM');
			// AWS Profile stays empty, so the driver falls back to the default credential chain,
			// which resolves the web identity token Workbench gives the session.
			await dataConnections.fillConnectionInputs({
				'Connection Name': connectionName,
				'Host': host,
			});
			// Start-up toasts (the provider settings migration) cover the Save button.
			await app.workbench.toasts.closeAll();
			await dataConnections.save();
			await dataConnections.expectConnectionInTree(connectionName);
			addedConnection = connectionName;

			await dataConnections.expandConnection(connectionName);
			await dataConnections.expandNode('Databases');
			// The database and its table share a name, so both lookups pass a node kind.
			await dataConnections.expandNode(database, 'database');
			await dataConnections.expandNode('Tables');
			await dataConnections.expectNodeVisible(table, 'table');
		});
	});
});
