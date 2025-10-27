/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { UnityCatalogMock } from './mocks/unityCatalogMock';
import { DatabricksFileProvider } from '../fs/dbfs';

suite('DBFS File System Provider Tests', () => {
	let sandbox: sinon.SinonSandbox;
	let mockCredProvider: any;

	setup(function () {
		sandbox = sinon.createSandbox();

		mockCredProvider = {
			getToken: sandbox.stub().resolves('mock-token'),
		};
	});

	teardown(function () {
		sandbox.restore();
	});

	test('DBFS provider should list directory contents', async () => {
		const fetchStub = sandbox.stub(global, 'fetch');
		const volumePath = '/Volumes/main/sales/data';
		const volumeKey = 'main.sales.data';

		// Configure fetch to return directory contents
		fetchStub
			.withArgs(
				sinon.match(
					new RegExp(`.*\\/api\\/2.0\\/fs\\/directories${volumePath}`),
				),
			)
			.resolves({
				ok: true,
				status: 200,
				json: async () => ({
					contents: UnityCatalogMock.volumeContents[volumeKey],
				}),
			} as Response);

		const provider = new DatabricksFileProvider(mockCredProvider);

		const uri = vscode.Uri.parse(`dbfs://example.databricks.com${volumePath}`);
		const contents = await provider.readDirectory(uri);

		// Verify directory contents
		assert.strictEqual(
			contents.length,
			UnityCatalogMock.volumeContents[volumeKey].length,
		);

		// Check that file types are correct
		for (let i = 0; i < contents.length; i++) {
			const [name, fileType] = contents[i];
			const mockEntry = UnityCatalogMock.volumeContents[volumeKey].find(
				(entry) => entry.name === name,
			);
			assert.ok(mockEntry, `Entry ${name} not found in mock data`);

			// Check the file type
			const expectedFileType = mockEntry.is_directory
				? vscode.FileType.Directory
				: vscode.FileType.File;
			assert.strictEqual(fileType, expectedFileType);
		}
	});

	test('DBFS provider should get file stat', async () => {
		const fetchStub = sandbox.stub(global, 'fetch');
		const filePath = '/Volumes/main/sales/data/customers.csv';

		// Mock response headers
		const headers = new Map();
		headers.set('content-length', '1024');
		headers.set('last-modified', new Date().toUTCString());

		// Configure fetch to return file stats
		fetchStub
			.withArgs(
				sinon.match(new RegExp(`.*\\/api\\/2.0\\/fs\\/files${filePath}`)),
			)
			.resolves({
				ok: true,
				status: 200,
				headers: {
					get: (name: string) => headers.get(name),
				},
			} as unknown as Response);

		// Create an instance of DatabricksFileProvider
		const provider = new DatabricksFileProvider(mockCredProvider);

		// Call stat
		const uri = vscode.Uri.parse(`dbfs://example.databricks.com${filePath}`);
		const stat = await provider.stat(uri);

		// Verify file stat
		assert.strictEqual(stat.type, vscode.FileType.File);
		assert.strictEqual(stat.size, 1024);
		assert.ok(stat.mtime > 0);
		assert.strictEqual(stat.permissions, vscode.FilePermission.Readonly);
	});

	test('DBFS provider should read file contents', async () => {
		const fetchStub = sandbox.stub(global, 'fetch');
		const filePath = '/Volumes/main/sales/data/customers.csv';
		const fileContent = new Uint8Array([65, 66, 67, 68]); // "ABCD"

		// Configure fetch to return file contents
		fetchStub
			.withArgs(
				sinon.match(new RegExp(`.*\\/api\\/2.0\\/fs\\/files${filePath}`)),
			)
			.resolves({
				ok: true,
				status: 200,
				arrayBuffer: async () => fileContent.buffer,
				headers: {
					get: () => 'application/octet-stream',
				},
			} as unknown as Response);

		// Create an instance of DatabricksFileProvider
		const provider = new DatabricksFileProvider(mockCredProvider);

		// Call readFile
		const uri = vscode.Uri.parse(`dbfs://example.databricks.com${filePath}`);
		const content = await provider.readFile(uri);

		// Verify file contents
		assert.deepStrictEqual(content, fileContent);
	});

	test('DBFS provider should handle unauthorized access', async () => {
		// Override mock credential provider to return no token
		mockCredProvider.getToken.resolves(undefined);

		// Create an instance of DatabricksFileProvider
		const provider = new DatabricksFileProvider(mockCredProvider);

		// Call readFile and expect it to error
		const uri = vscode.Uri.parse(
			'dbfs://example.databricks.com/Volumes/main/sales/data/customers.csv',
		);

		try {
			await provider.readFile(uri);
			assert.fail('Expected readFile to fail');
		} catch (error: any) {
			// The error code should be 'NoPermissions' in VS Code FileSystemError
			assert.ok(error);
			assert.ok(
				['NoPermissions', 'FileSystemError'].includes(error.name || error.code),
			);
		}
	});
});
