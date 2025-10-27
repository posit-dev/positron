/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import {
	UnityCatalogMock,
	TEST_WORKSPACE,
	TEST_TOKEN,
} from './mocks/unityCatalogMock';
import { CatalogNode } from '../catalog';
import { DatabricksCatalogProvider } from '../catalogs/databricks';

suite('Databricks Catalog Tree View Tests', () => {
	let sandbox: sinon.SinonSandbox;

	setup(function () {
		sandbox = sinon.createSandbox();
	});

	teardown(function () {
		sandbox.restore();
	});

	suite('Catalog Level Navigation', () => {
		test('Listing catalogs shows all available catalogs from Unity Catalog API', async () => {
			UnityCatalogMock.setupStubs(sandbox);

			const provider = new DatabricksCatalogProvider(
				TEST_WORKSPACE,
				TEST_TOKEN,
			);

			// Get the children (catalogs)
			const catalogs = await provider.getChildren();

			assert.strictEqual(catalogs.length, UnityCatalogMock.catalogs.length);

			// Check catalog names
			const catalogNames = catalogs.map((c: CatalogNode) => c.path);
			UnityCatalogMock.catalogs.forEach((catalog) => {
				assert.ok(catalogNames.includes(catalog.name));
			});

			// Check node types
			catalogs.forEach((node: CatalogNode) => {
				assert.strictEqual(node.type, 'catalog');
			});
		});
	});

	suite('Schema Level Navigation', () => {
		test('Selecting a catalog shows its schemas from Unity Catalog API', async () => {
			UnityCatalogMock.setupStubs(sandbox);

			const provider = new DatabricksCatalogProvider(
				TEST_WORKSPACE,
				TEST_TOKEN,
			);

			// Get the catalogs first
			const catalogs = await provider.getChildren();
			assert.ok(catalogs.length > 0);

			// Get schemas for the 'main' catalog
			const mainCatalog = catalogs.find((c: CatalogNode) => c.path === 'main');
			assert.ok(mainCatalog, 'Main catalog not found');

			const schemas = await provider.getChildren(mainCatalog);

			// Verify the result
			const expectedSchemas = UnityCatalogMock.schemas['main'];
			assert.strictEqual(schemas.length, expectedSchemas.length);

			// Check schema paths
			const schemaNames = schemas.map((s: CatalogNode) => s.path.split('.')[1]); // Extract schema name from path
			expectedSchemas.forEach((schema) => {
				assert.ok(schemaNames.includes(schema.name));
			});

			// Check node types
			schemas.forEach((node: CatalogNode) => {
				assert.strictEqual(node.type, 'schema');
			});
		});
	});

	suite('Table and Volume Level Navigation', () => {
		test('Selecting a schema shows its tables and volumes from Unity Catalog API', async () => {
			UnityCatalogMock.setupStubs(sandbox);

			const provider = new DatabricksCatalogProvider(
				TEST_WORKSPACE,
				TEST_TOKEN,
			);

			// Create a schema node for 'main.sales'
			const schemaNode = new CatalogNode('main.sales', 'schema', provider);

			// Get tables and volumes for the schema
			const children = await provider.getChildren(schemaNode);

			// Verify the result
			const expectedTables = UnityCatalogMock.tables['main']['sales'] || [];
			const expectedVolumes = UnityCatalogMock.volumes['main']['sales'] || [];
			assert.strictEqual(
				children.length,
				expectedTables.length + expectedVolumes.length,
			);

			// Check table nodes
			const tableNodes = children.filter(
				(node: CatalogNode) => node.type === 'table',
			);
			assert.strictEqual(tableNodes.length, expectedTables.length);

			// Check table names
			const tableNames = tableNodes.map(
				(t: CatalogNode) => t.path.split('.')[2],
			); // Extract table name from path
			expectedTables.forEach((table) => {
				assert.ok(tableNames.includes(table.name));
			});

			// Check volume nodes
			const volumeNodes = children.filter(
				(node: CatalogNode) => node.type === 'volume',
			);
			assert.strictEqual(volumeNodes.length, expectedVolumes.length);

			// Check volume names
			const volumeNames = volumeNodes.map(
				(v: CatalogNode) => v.path.split('.')[2],
			); // Extract volume name from path
			expectedVolumes.forEach((volume) => {
				assert.ok(volumeNames.includes(volume.name));
			});
		});
	});
});
