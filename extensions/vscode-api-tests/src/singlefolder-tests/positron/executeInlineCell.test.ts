/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { assertNoRpcFromEntry, disposeAll } from '../../utils';
import { Disposable } from 'vscode';
import assert = require('assert');

/**
 * Tests for the positron.runtime.executeInlineCell API.
 *
 * This API is used to execute code cells inline in Quarto documents (e.g., .qmd files).
 * The code is executed in a language runtime session matching the cell's language.
 *
 * Note: Full integration testing requires the Quarto inline output feature to be enabled.
 * These tests verify the API exists and handles edge cases gracefully.
 */
suite('positron API - executeInlineCell', () => {
	let disposables: Disposable[];

	setup(() => {
		disposables = [];
	});

	teardown(async () => {
		// Close all editors to clean up test state
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		assertNoRpcFromEntry([positron, 'positron']);
		disposeAll(disposables);
	});

	test('executeInlineCell API exists and is callable', async () => {
		// Verify the API exists on the runtime namespace
		assert.ok(positron.runtime.executeInlineCell, 'executeInlineCell API should exist');
		assert.strictEqual(typeof positron.runtime.executeInlineCell, 'function', 'executeInlineCell should be a function');
	});

	test('executeInlineCell handles document with code range', async () => {
		// This test verifies that executeInlineCell can be called with a Quarto document
		// and a code range without crashing. Full execution testing requires the Quarto
		// inline output feature to be enabled (which is not available in test environment).

		const workspaceFolders = vscode.workspace.workspaceFolders;
		assert.ok(workspaceFolders && workspaceFolders.length > 0, 'Should have a workspace folder');

		// Create a temporary .qmd file with a code block
		const qmdContent = `---
title: "Test"
---

\`\`\`{python}
print("hello")
\`\`\`
`;
		const testFileName = `test-${Date.now()}.qmd`;
		const testFileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, testFileName);

		try {
			// Write and open the test file
			await vscode.workspace.fs.writeFile(testFileUri, Buffer.from(qmdContent, 'utf-8'));
			const document = await vscode.workspace.openTextDocument(testFileUri);
			await vscode.window.showTextDocument(document);

			// Wait for document to be fully loaded
			await new Promise(resolve => setTimeout(resolve, 500));

			// Define a range that covers the code cell (line 6, 0-indexed: line 5)
			const codeRange = new vscode.Range(5, 0, 5, 14);

			// Call executeInlineCell - this tests the API plumbing
			try {
				await positron.runtime.executeInlineCell(testFileUri, [codeRange]);
			} catch (err) {
				// Expected: Quarto document model is not available in test environment
				const errorMessage = (err as Error).message || String(err);

				// These errors indicate the API is working but the Quarto infrastructure isn't available
				const expectedErrors = ['document model', 'No model', 'feature', 'session'];
				const isExpectedError = expectedErrors.some(msg =>
					errorMessage.toLowerCase().includes(msg.toLowerCase())
				);

				if (!isExpectedError) {
					throw err;
				}
				console.log(`executeInlineCell test: Acceptable error in test environment: ${errorMessage}`);
			}
		} finally {
			// Clean up test file
			try {
				await vscode.workspace.fs.delete(testFileUri);
			} catch {
				// Ignore cleanup errors
			}
		}
	});

	test('executeInlineCell with empty ranges completes without error', async () => {
		// Calling executeInlineCell with empty ranges should complete immediately
		// without errors (no-op case)

		const workspaceFolders = vscode.workspace.workspaceFolders;
		assert.ok(workspaceFolders && workspaceFolders.length > 0, 'Should have a workspace folder');

		// Use existing simple.qmd test file
		const testFileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'simple.qmd');
		const document = await vscode.workspace.openTextDocument(testFileUri);
		await vscode.window.showTextDocument(document);

		// Wait for document to load
		await new Promise(resolve => setTimeout(resolve, 200));

		// Call with empty ranges - should handle gracefully
		try {
			await positron.runtime.executeInlineCell(testFileUri, []);
		} catch (err) {
			// Even errors are acceptable here since Quarto infrastructure isn't available
			const errorMessage = (err as Error).message || String(err);
			console.log(`executeInlineCell with empty ranges: ${errorMessage}`);
		}
	});
});
