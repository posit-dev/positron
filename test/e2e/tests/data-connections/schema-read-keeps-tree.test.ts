/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename,
});

const connectionName = 'duckdbSchemaRead';

test.describe('Data Connections - Schema Read', {
	tag: [tags.WEB, tags.WIN, tags.CONNECTIONS]
}, () => {

	test('Rows loaded before a schema read still expand after it', async function ({ app }) {
		const { dataConnections } = app.workbench;
		const databaseFile = join(app.workspacePathOrFolder, 'data-files/order-tracking/order_tracking.duckdb');

		await dataConnections.openDataConnectionsView();
		await dataConnections.clickAddConnection();
		await dataConnections.selectProvider('DuckDB');
		await dataConnections.fillConnectionInputs({
			'Connection Name': connectionName,
			'Database File': databaseFile,
		});
		await dataConnections.save();
		await dataConnections.expandConnection(connectionName);
		await dataConnections.expectNodeVisible('Tables');

		// The command Posit Assistant runs to read a connection's schema.
		const schema = await app.code.driver.executeCommand('positronDataConnections.getSchema');
		expect(JSON.stringify(schema)).toContain('customers');

		await dataConnections.expandNode('Tables');
		await dataConnections.expectNodeVisible('customers');
	});
});
