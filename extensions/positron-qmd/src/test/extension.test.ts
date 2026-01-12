/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { captureLogs } from './util/captureLogs.js';
import { QmdDocument } from '../qmdDocument.js';

const EXTENSION_ID = 'positron.positron-qmd';

function getPositronQmdExtension() {
	const extension = vscode.extensions.getExtension(EXTENSION_ID);
	assert.ok(extension, `Extension ${EXTENSION_ID} should be present`);
	return extension;
}

async function parseQmd(content: string): Promise<QmdDocument | undefined> {
	return await vscode.commands.executeCommand(
		'positron-qmd.parseQmd',
		content
	);
}

suite('Positron QMD Extension Test Suite', () => {
	captureLogs();

	test('Extension should be present', () => {
		getPositronQmdExtension();
	});

	test('Extension should activate', async () => {
		const extension = getPositronQmdExtension();
		await extension.activate();
		assert.ok(extension.isActive, 'Extension should be active');
	});

	suite('With experimental setting enabled', () => {
		let originalValue: boolean | undefined;

		suiteSetup(async () => {
			// Save original value
			originalValue = vscode.workspace
				.getConfiguration('notebook.plainText')
				.get<boolean>('enable');

			// Enable the experimental setting
			await vscode.workspace
				.getConfiguration('notebook.plainText')
				.update('enable', true, vscode.ConfigurationTarget.Global);

			// Wait for configuration change to propagate
			await new Promise(resolve => setTimeout(resolve, 500));
		});

		suiteTeardown(async () => {
			// Restore original value
			await vscode.workspace
				.getConfiguration('notebook.plainText')
				.update('enable', originalValue, vscode.ConfigurationTarget.Global);
		});

		test('Command positron-qmd.parseQmd should be registered', async () => {
			const commands = await vscode.commands.getCommands(true);
			assert.ok(
				commands.includes('positron-qmd.parseQmd'),
				'Command should be registered'
			);
		});

		test('WASM parser should parse simple QMD content', async () => {
			const qmdContent = `---
title: Test
---

# Hello

\`\`\`{python}
print("hello")
\`\`\`
`;

			const result = await parseQmd(qmdContent);

			assert.ok(result, 'Parser should return a result');
			assert.ok(Array.isArray(result.blocks), 'Result should have blocks array');
			assert.ok(result.meta, 'Result should have meta object');
			assert.ok(result['pandoc-api-version'], 'Result should have pandoc-api-version');
		});
	});

	suite('With experimental setting disabled', () => {
		suiteSetup(async () => {
			// Disable the experimental setting
			await vscode.workspace
				.getConfiguration('notebook.plainText')
				.update('enable', false, vscode.ConfigurationTarget.Global);

			// Wait for configuration change to propagate
			await new Promise(resolve => setTimeout(resolve, 500));
		});

		test('Command should be unregistered when disabled', async () => {
			// When the setting is disabled, ExtensionEnablement disposes the
			// QmdParserService, which unregisters the command
			const commands = await vscode.commands.getCommands(true);

			assert.ok(
				!commands.includes('positron-qmd.parseQmd'),
				'Command should be unregistered when setting is disabled'
			);
		});
	});
});
