/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { isCompletionEnabled } from '../config.js';

function setupConfigStubs(values: {
	aiExcludes?: string[];
	enable?: Record<string, boolean>;
}): void {
	const positronAssistantGet = sinon.stub();
	positronAssistantGet.withArgs('aiExcludes').returns(values.aiExcludes);

	const nextEditSuggestionsGet = sinon.stub();
	nextEditSuggestionsGet.withArgs('enabled').returns(values.enable);

	const getConfiguration = sinon.stub(vscode.workspace, 'getConfiguration');
	getConfiguration.withArgs('positron.assistant').returns({ get: positronAssistantGet } as unknown as vscode.WorkspaceConfiguration);
	getConfiguration.withArgs('nextEditSuggestions').returns({ get: nextEditSuggestionsGet } as unknown as vscode.WorkspaceConfiguration);
}

function mockDocument(fsPath: string, languageId: string): vscode.TextDocument {
	const uri = vscode.Uri.file(fsPath);
	return { uri, fileName: uri.fsPath, languageId } as vscode.TextDocument;
}

suite('config / isCompletionEnabled', () => {
	teardown(() => {
		sinon.restore();
	});

	suite('aiExcludes takes precedence over nextEditSuggestions.enabled', () => {
		test('path-style glob (with slash) excludes matching file', () => {
			setupConfigStubs({
				aiExcludes: ['**/.env'],
				enable: { '*': true, typescript: true },
			});

			const doc = mockDocument('/project/.env', 'plaintext');
			assert.strictEqual(isCompletionEnabled(doc), false);
		});

		test('basename-style glob (no slash) excludes matching file', () => {
			setupConfigStubs({
				aiExcludes: ['*.env'],
				enable: { '*': true },
			});

			const doc = mockDocument('/project/config/secrets.env', 'plaintext');
			assert.strictEqual(isCompletionEnabled(doc), false);
		});

		test('non-excluded file falls through to enable check', () => {
			setupConfigStubs({
				aiExcludes: ['**/.env'],
				enable: { '*': true },
			});

			const doc = mockDocument('/project/src/file.ts', 'typescript');
			assert.strictEqual(isCompletionEnabled(doc), true);
		});

		test('empty aiExcludes does not block any file', () => {
			setupConfigStubs({
				aiExcludes: [],
				enable: { '*': true },
			});

			const doc = mockDocument('/project/.env', 'plaintext');
			assert.strictEqual(isCompletionEnabled(doc), true);
		});

		test('undefined aiExcludes does not block any file', () => {
			setupConfigStubs({
				enable: { '*': true },
			});

			const doc = mockDocument('/project/.env', 'plaintext');
			assert.strictEqual(isCompletionEnabled(doc), true);
		});

		test('checks all aiExcludes patterns and matches later entries', () => {
			setupConfigStubs({
				aiExcludes: ['**/*.env', '*.snap'],
				enable: { '*': true },
			});

			const doc = mockDocument('/project/component.snap', 'plaintext');
			assert.strictEqual(isCompletionEnabled(doc), false);
		});
	});

	suite('nextEditSuggestions.enabled fallback ordering', () => {
		// Precedence: language ID > filename glob > '*' wildcard > implicit true.
		test('aiExcludes short-circuits enable check (blocks even when enable would allow)', () => {
			setupConfigStubs({
				aiExcludes: ['**/*.env'],
				enable: { '*': true, plaintext: true },
			});

			const doc = mockDocument('/project/secrets.env', 'plaintext');
			assert.strictEqual(isCompletionEnabled(doc), false);
		});

		test('language ID match wins over filename glob match', () => {
			setupConfigStubs({
				aiExcludes: [],
				enable: { '*': true, typescript: true, '*.ts': false },
			});

			const doc = mockDocument('/project/src/file.ts', 'typescript');
			assert.strictEqual(isCompletionEnabled(doc), true);
		});

		test('per-language ID match wins over wildcard', () => {
			setupConfigStubs({
				aiExcludes: [],
				enable: { '*': true, markdown: false },
			});

			const doc = mockDocument('/project/notes.md', 'markdown');
			assert.strictEqual(isCompletionEnabled(doc), false);
		});

		test('filename glob match wins over wildcard when no language match', () => {
			setupConfigStubs({
				aiExcludes: [],
				enable: { '*': true, '*.snap': false },
			});

			const doc = mockDocument('/project/component.snap', 'plaintext');
			assert.strictEqual(isCompletionEnabled(doc), false);
		});

		test('exact filename match applies when no language match exists', () => {
			setupConfigStubs({
				aiExcludes: [],
				enable: { '*': true, Dockerfile: false },
			});

			const doc = mockDocument('/project/Dockerfile', 'plaintext');
			assert.strictEqual(isCompletionEnabled(doc), false);
		});

		test('when multiple filename keys match, first matching key wins', () => {
			setupConfigStubs({
				aiExcludes: [],
				enable: { '*': true, '*.ts': false, 'file.ts': true },
			});

			const doc = mockDocument('/project/src/file.ts', 'plaintext');
			assert.strictEqual(isCompletionEnabled(doc), false);
		});

		test('filename extension matching works with Windows-style file paths', () => {
			setupConfigStubs({
				aiExcludes: [],
				enable: { '*': true, '*.ts': false },
			});

			const doc = {
				uri: vscode.Uri.file('/project/src/file.ts'),
				fileName: 'C:\\project\\src\\file.ts',
				languageId: 'plaintext',
			} as vscode.TextDocument;

			assert.strictEqual(isCompletionEnabled(doc), false);
		});

		test('wildcard applies when no language or glob match', () => {
			setupConfigStubs({
				aiExcludes: [],
				enable: { '*': false },
			});

			const doc = mockDocument('/project/src/file.ts', 'typescript');
			assert.strictEqual(isCompletionEnabled(doc), false);
		});

		test('defaults to true when enable config has no matching key', () => {
			setupConfigStubs({
				aiExcludes: [],
				enable: {},
			});

			const doc = mockDocument('/project/src/file.ts', 'typescript');
			assert.strictEqual(isCompletionEnabled(doc), true);
		});

		test('defaults to true when enable config is undefined', () => {
			setupConfigStubs({
				aiExcludes: [],
			});

			const doc = mockDocument('/project/src/file.ts', 'typescript');
			assert.strictEqual(isCompletionEnabled(doc), true);
		});
	});
});
