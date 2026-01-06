/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { buildProjectTree } from '../../tools/projectTreeTool.js';

/**
 * Helper function to create test workspace folders with proper path construction.
 */
function createTestWorkspaceFolders(): vscode.WorkspaceFolder[] {
	const extensionRoot = path.join(__dirname, '..', '..', '..');

	return [
		{
			uri: vscode.Uri.file(path.join(extensionRoot, 'test-workspace')),
			name: 'test-workspace',
			index: 0
		},
		{
			uri: vscode.Uri.file(path.join(extensionRoot, 'test-workspace2')),
			name: 'test-workspace2',
			index: 1
		}
	];
}

/**
 * Helper function to validate test workspace exists.
 */
async function validateTestWorkspaceExists(workspaceUri: vscode.Uri): Promise<void> {
	try {
		await vscode.workspace.fs.stat(workspaceUri);
	} catch (error) {
		throw new Error(`Test workspace directory should exist at: ${workspaceUri.fsPath}`);
	}
}

suite('ProjectTreeTool', () => {
	teardown(() => {
		sinon.restore();
	});

	suite('Single Workspace - Files', () => {
		test('should return correct file info for test workspace', async () => {
			// Test the actual buildProjectTree function using the real test workspace
			const options = {
				input: {
					include: ['**/*.txt']
				}
			} as vscode.LanguageModelToolInvocationOptions<any>;

			const token = new vscode.CancellationTokenSource().token;

			// Verify we have the test workspace available
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			assert.ok(workspaceFolder, 'This test should be run from the ../test-workspace workspace');

			const result = await buildProjectTree(options, token);

			// Verify the result structure
			assert.ok(result instanceof vscode.LanguageModelToolResult);
			assert.ok(result.content.length >= 1);
			assert.ok(result.content[0] instanceof vscode.LanguageModelTextPart);

			const content = (result.content[0] as vscode.LanguageModelTextPart).value;
			assert.ok(typeof content === 'string');

			// Verify specific .txt files from the test workspace are included
			assert.ok(content.includes('folder/file.txt'), 'Should include folder/file.txt');
			assert.ok(content.includes('folder/subfolder/file.txt'), 'Should include folder/subfolder/file.txt');

			// Verify .ts files are filtered out
			assert.ok(!content.includes('reference.ts'), 'Should NOT include reference.ts when filtering for .txt files');

			// Should not have workspace headers for single workspace
			assert.ok(!content.includes('##'), 'Single workspace should not have headers');
		});
	});

	suite('Single Workspace - Directories', () => {
		test('should return correct directory info for test workspace', async () => {
			// Test the actual buildProjectTree function for directories only
			const options = {
				input: {
					include: ['**/*'],
					directoriesOnly: true
				}
			} as vscode.LanguageModelToolInvocationOptions<any>;

			const token = new vscode.CancellationTokenSource().token;

			// Verify we have the test workspace available
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			assert.ok(workspaceFolder, 'This test should be run from the ../test-workspace workspace');

			const result = await buildProjectTree(options, token);

			// Verify the result structure
			assert.ok(result instanceof vscode.LanguageModelToolResult);
			assert.ok(result.content.length >= 1);

			const content = (result.content[0] as vscode.LanguageModelTextPart).value;
			assert.ok(typeof content === 'string');

			// Verify specific directories from the test workspace are included
			assert.ok(content.includes('folder/'), 'Should include folder/ directory');
			assert.ok(content.includes('folder/subfolder/'), 'Should include folder/subfolder/ directory');

			// Verify files are filtered out when directoriesOnly is true
			assert.ok(!content.includes('reference.ts'), 'Should NOT include reference.ts when directoriesOnly is true');
			assert.ok(!content.includes('file.txt'), 'Should NOT include file.txt when directoriesOnly is true');

			// Should not have workspace headers for single workspace
			assert.ok(!content.includes('##'), 'Single workspace should not have headers');

			// All directory entries should end with '/'
			const lines = content.trim().split('\n');
			const directoryLines = lines.filter(line => !line.startsWith('##') && line.trim().length > 0);
			directoryLines.forEach(line => {
				assert.ok(line.trim().endsWith('/'), `Directory line should end with '/': ${line}`);
			});
		});
	});

	suite('Multi-Root Workspace - Files', () => {
		test('should handle files correctly across multiple workspace folders', async () => {
			// Test the actual buildProjectTree function for multi-root workspace
			const options = {
				input: {
					include: ['**/*']
				}
			} as vscode.LanguageModelToolInvocationOptions<any>;

			const token = new vscode.CancellationTokenSource().token;

			// Set up multiple workspace folders using helper function
			const testWorkspaceFolders = createTestWorkspaceFolders();

			// Validate test workspaces exist
			for (const folder of testWorkspaceFolders) {
				await validateTestWorkspaceExists(folder.uri);
			}

			// Mock the workspace.workspaceFolders property
			sinon.stub(vscode.workspace, 'workspaceFolders').value(testWorkspaceFolders);

			const result = await buildProjectTree(options, token);

			// Verify the result structure
			assert.ok(result instanceof vscode.LanguageModelToolResult);
			assert.ok(result.content.length >= 1);

			// With multiple workspace folders, should have workspace headers
			const allContent = result.content.map(part => (part as vscode.LanguageModelTextPart).value).join('\n');

			// Verify all expected files from both workspaces are included
			assert.ok(allContent.includes('reference.ts'), 'Should include reference.ts from first workspace');
			assert.ok(allContent.includes('folder/file.txt'), 'Should include folder/file.txt from first workspace');
			assert.ok(allContent.includes('folder/subfolder/file.txt'), 'Should include folder/subfolder/file.txt from first workspace');
			assert.ok(allContent.includes('script.py'), 'Should include script.py from second workspace');
			assert.ok(allContent.includes('data/sample.csv'), 'Should include data/sample.csv from second workspace');

			// Verify workspace names appear as headers
			assert.ok(allContent.includes('## test-workspace'), 'Should include first workspace name in headers');
			assert.ok(allContent.includes('## test-workspace2'), 'Should include second workspace name in headers');
		});
	});

	suite('Multi-Root Workspace - Directories', () => {
		test('should handle directories correctly across multiple workspace folders', async () => {
			// Test the actual buildProjectTree function for multi-root workspace directories
			const options = {
				input: {
					include: ['**/*'],
					directoriesOnly: true
				}
			} as vscode.LanguageModelToolInvocationOptions<any>;

			const token = new vscode.CancellationTokenSource().token;

			// Set up multiple workspace folders using helper function
			const testWorkspaceFolders = createTestWorkspaceFolders();

			// Validate test workspaces exist
			for (const folder of testWorkspaceFolders) {
				await validateTestWorkspaceExists(folder.uri);
			}

			// Mock the workspace.workspaceFolders property
			sinon.stub(vscode.workspace, 'workspaceFolders').value(testWorkspaceFolders);

			const result = await buildProjectTree(options, token);

			// Verify the result structure
			assert.ok(result instanceof vscode.LanguageModelToolResult);
			assert.ok(result.content.length >= 1);

			// With multiple workspace folders, should have workspace headers
			const allContent = result.content.map(part => (part as vscode.LanguageModelTextPart).value).join('\n');

			// Verify specific directories from both workspaces are included
			assert.ok(allContent.includes('folder/'), 'Should include folder/ from first workspace');
			assert.ok(allContent.includes('folder/subfolder/'), 'Should include folder/subfolder/ from first workspace');
			assert.ok(allContent.includes('data/'), 'Should include data/ from second workspace');

			// Verify workspace names appear as headers
			assert.ok(allContent.includes('## test-workspace'), 'Should include first workspace name in headers');
			assert.ok(allContent.includes('## test-workspace2'), 'Should include second workspace name in headers');

			// Verify files are filtered out when directoriesOnly is true
			assert.ok(!allContent.includes('reference.ts'), 'Should NOT include files when directoriesOnly is true');
			assert.ok(!allContent.includes('script.py'), 'Should NOT include files when directoriesOnly is true');
			assert.ok(!allContent.includes('file.txt'), 'Should NOT include files when directoriesOnly is true');
			assert.ok(!allContent.includes('sample.csv'), 'Should NOT include files when directoriesOnly is true');

			// All directory entries should end with '/'
			const lines = allContent.split('\n');
			const directoryLines = lines.filter(line => !line.startsWith('##') && line.trim().length > 0);
			directoryLines.forEach(line => {
				assert.ok(line.trim().endsWith('/'), `Directory line should end with '/': ${line}`);
			});
		});
	});

	suite('Empty workspace', () => {
		test('should reject when no folders are open in the workspace', async () => {
			const options = {
				input: {
					include: ['**/*']
				}
			} as vscode.LanguageModelToolInvocationOptions<any>;
			const token = new vscode.CancellationTokenSource().token;
			sinon.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			let errorThrown = false;
			try {
				await buildProjectTree(options, token);
			} catch (error) {
				errorThrown = true;
				assert.ok(error instanceof Error);
				assert.ok(error.message.includes('no workspace folders are open'),
					`Expected error message to mention 'no workspace folders are open', got: ${error.message}`);
			}

			assert.ok(errorThrown, 'Expected an error to be thrown when no workspace folders are open');
		});
	});
});
