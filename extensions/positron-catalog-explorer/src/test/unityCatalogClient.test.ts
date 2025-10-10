/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { UnityCatalogClient } from '../catalogs/unityCatalogClient';
import { DatabricksFilesClient } from '../fs/dbfs';
import {
	mockCatalogs,
	mockSchemas,
	mockTables,
	mockVolumes,
	mockVolumeContents,
	TEST_WORKSPACE,
	TEST_TOKEN,
} from './mocks/unityCatalogMock';

suite('Unity Catalog API Client Tests', () => {
	let sandbox: sinon.SinonSandbox;

	setup(function () {
		sandbox = sinon.createSandbox();
	});

	teardown(function () {
		sandbox.restore();
	});

	suite('Catalog Operations', () => {
		test('UnityCatalogClient.listCatalogs should return catalogs and use the correct endpoint', async () => {
			const fetchStub = sandbox.stub(global, 'fetch');

			fetchStub.resolves({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ catalogs: mockCatalogs }),
			} as Response);

			// Create an instance of UnityCatalogClient
			const client = new UnityCatalogClient(
				`https://${TEST_WORKSPACE}`,
				TEST_TOKEN,
			);

			// Call the method
			const result = await client.listCatalogs();

			// Assert the result
			assert.deepStrictEqual(result, mockCatalogs);

			// Verify the fetch call
			assert.ok(fetchStub.calledOnce);
			assert.ok(
				fetchStub.firstCall.args[0]
					.toString()
					.includes('/api/2.1/unity-catalog/catalogs'),
			);

			// Verify headers
			const options = fetchStub.firstCall.args[1] as RequestInit;
			const headers = options.headers as Record<string, string>;
			assert.strictEqual(
				headers['Authorization'],
				`Bearer ${TEST_TOKEN}`,
				'Authorization header is incorrect',
			);
		});

		test('UnityCatalogClient.listCatalogs should handle empty results properly', async () => {
			const fetchStub = sandbox.stub(global, 'fetch');

			// Configure fetch to return empty catalogs
			fetchStub
				.withArgs(sinon.match(/.*\/api\/2.1\/unity-catalog\/catalogs$/))
				.resolves({
					ok: true,
					status: 200,
					json: async () => ({ catalogs: [] }),
				} as Response);

			// Create an instance of UnityCatalogClient
			const client = new UnityCatalogClient(
				`https://${TEST_WORKSPACE}`,
				TEST_TOKEN,
			);

			// Call the method
			const result = await client.listCatalogs();

			// Assert the result is an empty array
			assert.deepStrictEqual(result, []);
		});
	});

	suite('Schema Operations', () => {
		test('UnityCatalogClient.listSchemas should return schemas with correct endpoint and parameters', async () => {
			const fetchStub = sandbox.stub(global, 'fetch');

			fetchStub.resolves({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ schemas: mockSchemas['main'] }),
			} as Response);

			// Create an instance of UnityCatalogClient
			const client = new UnityCatalogClient(
				`https://${TEST_WORKSPACE}`,
				TEST_TOKEN,
			);

			// Call the method
			const result = await client.listSchemas('main');

			// Assert the result
			assert.deepStrictEqual(result, mockSchemas['main']);

			// Verify the fetch call
			assert.ok(fetchStub.calledOnce);
			const url = new URL(fetchStub.firstCall.args[0].toString());
			assert.ok(url.pathname.includes('/api/2.1/unity-catalog/schemas'));
			assert.strictEqual(url.searchParams.get('catalog_name'), 'main');
		});

		test('UnityCatalogClient.listSchemas should handle empty results properly', async () => {
			const fetchStub = sandbox.stub(global, 'fetch');

			// Configure fetch to return empty schemas
			fetchStub
				.withArgs(
					sinon.match(
						/.*\/api\/2.1\/unity-catalog\/schemas\?catalog_name=empty_catalog/,
					),
				)
				.resolves({
					ok: true,
					status: 200,
					json: async () => ({ schemas: [] }),
				} as Response);

			// Create an instance of UnityCatalogClient
			const client = new UnityCatalogClient(
				`https://${TEST_WORKSPACE}`,
				TEST_TOKEN,
			);

			// Call the method
			const result = await client.listSchemas('empty_catalog');

			// Assert the result is an empty array
			assert.deepStrictEqual(result, []);
		});
	});

	suite('Table Operations', () => {
		test('UnityCatalogClient.listTables should return tables with correct endpoint and parameters', async () => {
			const fetchStub = sandbox.stub(global, 'fetch');

			fetchStub.resolves({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ tables: mockTables['main']['sales'] }),
			} as Response);

			// Create an instance of UnityCatalogClient
			const client = new UnityCatalogClient(
				`https://${TEST_WORKSPACE}`,
				TEST_TOKEN,
			);

			// Call the method
			const result = await client.listTables('main', 'sales');

			// Assert the result
			assert.deepStrictEqual(result, mockTables['main']['sales']);

			// Verify the fetch call
			assert.ok(fetchStub.calledOnce);
			const url = new URL(fetchStub.firstCall.args[0].toString());
			assert.ok(url.pathname.includes('/api/2.1/unity-catalog/tables'));
			assert.strictEqual(url.searchParams.get('catalog_name'), 'main');
			assert.strictEqual(url.searchParams.get('schema_name'), 'sales');
		});

		test('UnityCatalogClient.listTables should handle empty results properly', async () => {
			const fetchStub = sandbox.stub(global, 'fetch');

			// Configure fetch to return empty tables
			fetchStub
				.withArgs(
					sinon.match(
						/.*\/api\/2.1\/unity-catalog\/tables\?catalog_name=main&schema_name=empty_schema/,
					),
				)
				.resolves({
					ok: true,
					status: 200,
					json: async () => ({ tables: [] }),
				} as Response);

			// Create an instance of UnityCatalogClient
			const client = new UnityCatalogClient(
				`https://${TEST_WORKSPACE}`,
				TEST_TOKEN,
			);

			// Call the method
			const result = await client.listTables('main', 'empty_schema');

			// Assert the result is an empty array
			assert.deepStrictEqual(result, []);
		});
	});

	suite('Volume Operations', () => {
		test('UnityCatalogClient.listVolumes should return volumes with correct endpoint and parameters', async () => {
			const fetchStub = sandbox.stub(global, 'fetch');

			fetchStub.resolves({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ volumes: mockVolumes['main']['sales'] }),
			} as Response);

			// Create an instance of UnityCatalogClient
			const client = new UnityCatalogClient(
				`https://${TEST_WORKSPACE}`,
				TEST_TOKEN,
			);

			// Call the method
			const result = await client.listVolumes('main', 'sales');

			// Assert the result
			assert.deepStrictEqual(result, mockVolumes['main']['sales']);

			// Verify the fetch call
			assert.ok(fetchStub.calledOnce);
			const url = new URL(fetchStub.firstCall.args[0].toString());
			assert.ok(url.pathname.includes('/api/2.1/unity-catalog/volumes'));
			assert.strictEqual(url.searchParams.get('catalog_name'), 'main');
			assert.strictEqual(url.searchParams.get('schema_name'), 'sales');
		});

		test('UnityCatalogClient.listVolumes should handle empty results properly', async () => {
			const fetchStub = sandbox.stub(global, 'fetch');

			// Configure fetch to return empty volumes
			fetchStub
				.withArgs(
					sinon.match(
						/.*\/api\/2.1\/unity-catalog\/volumes\?catalog_name=main&schema_name=empty_schema/,
					),
				)
				.resolves({
					ok: true,
					status: 200,
					json: async () => ({ volumes: [] }),
				} as Response);

			// Create an instance of UnityCatalogClient
			const client = new UnityCatalogClient(
				`https://${TEST_WORKSPACE}`,
				TEST_TOKEN,
			);

			// Call the method
			const result = await client.listVolumes('main', 'empty_schema');

			// Assert the result is an empty array
			assert.deepStrictEqual(result, []);
		});
	});

	suite('File System Operations', () => {
		test('DatabricksFilesClient.listContents should return directory contents with correct endpoint', async () => {
			const fetchStub = sandbox.stub(global, 'fetch');

			fetchStub.resolves({
				ok: true,
				status: 200,
				json: () =>
					Promise.resolve({
						contents: mockVolumeContents['main.sales.data'],
					}),
			} as Response);

			// Create an instance of DatabricksFilesClient
			const client = new DatabricksFilesClient(
				`https://${TEST_WORKSPACE}`,
				TEST_TOKEN,
			);

			// Call the method
			const result = await client.listContents('/Volumes/main/sales/data');

			// Assert the result
			assert.deepStrictEqual(result, mockVolumeContents['main.sales.data']);

			// Verify the fetch call
			assert.ok(fetchStub.calledOnce);
			const url = fetchStub.firstCall.args[0].toString();
			assert.ok(
				url.includes('/api/2.0/fs/directories/Volumes/main/sales/data'),
			);
		});
	});

	suite('Error Handling', () => {
		test('UnityCatalogClient should handle API errors gracefully', async () => {
			const fetchStub = sandbox.stub(global, 'fetch');

			// Configure fetch to return an error response
			fetchStub
				.withArgs(sinon.match(/.*\/api\/2.1\/unity-catalog\/catalogs$/))
				.resolves({
					ok: false,
					status: 401,
					json: async () => ({
						error: {
							message: 'Invalid authentication token',
							type: 'AUTHENTICATION_EXCEPTION',
							code: 401,
						},
					}),
				} as Response);

			// Create an instance of UnityCatalogClient
			const client = new UnityCatalogClient(
				`https://${TEST_WORKSPACE}`,
				'invalid-token',
			);

			// Call the method and expect an error
			try {
				await client.listCatalogs();
				assert.fail('Should have thrown an error');
			} catch (error) {
				assert.ok(error instanceof Error);
				if (error instanceof Error) {
					assert.ok(
						error.message.includes('Invalid authentication token'),
						`Error message is incorrect: ${error.message}`,
					);
				}
				// Check if it's the specialized UnityCatalogError type
				if ('type' in error) {
					assert.strictEqual(
						(error as any).type,
						'AUTHENTICATION_EXCEPTION',
						'Error type is incorrect',
					);
					assert.strictEqual(
						(error as any).code,
						401,
						'Error code is incorrect',
					);
				}
			}
		});

		test('UnityCatalogClient should handle non-JSON error responses', async () => {
			const fetchStub = sandbox.stub(global, 'fetch');

			// Configure fetch to return a non-JSON error response
			// Cast to unknown first to avoid TypeScript errors with the Response interface
			const mockErrorResponse = {
				ok: false,
				status: 500,
				json: async () => {
					throw new Error('Invalid JSON');
				},
				headers: new Headers(),
				statusText: 'Internal Server Error',
				type: 'default',
				url: `https://${TEST_WORKSPACE}/api/2.1/unity-catalog/catalogs`,
				clone: () => ({}) as Response,
				body: null,
				bodyUsed: false,
				redirected: false,
				arrayBuffer: async () => new ArrayBuffer(0),
				blob: async () => new Blob(['error']),
				formData: async () => new FormData(),
				text: async () => '',
			};
			fetchStub
				.withArgs(sinon.match(/.*\/api\/2.1\/unity-catalog\/catalogs$/))
				.resolves(mockErrorResponse as unknown as Response);

			// Create an instance of UnityCatalogClient
			const client = new UnityCatalogClient(
				`https://${TEST_WORKSPACE}`,
				TEST_TOKEN,
			);

			// Call the method and expect an error
			try {
				await client.listCatalogs();
				assert.fail('Should have thrown an error');
			} catch (error) {
				assert.ok(error instanceof Error);
				if (error instanceof Error) {
					assert.ok(
						error.message.includes('Non-JSON response with status 500'),
						`Error message is incorrect: ${error.message}`,
					);
				}
				// Check if it's the specialized UnityCatalogError type
				if ('type' in error) {
					assert.strictEqual(
						(error as any).type,
						'Unknown',
						'Error type is incorrect',
					);
					assert.strictEqual(
						(error as any).code,
						500,
						'Error code is incorrect',
					);
				}
			}
		});
	});
});
