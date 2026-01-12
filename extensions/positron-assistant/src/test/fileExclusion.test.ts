/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { isFileExcludedFromAI } from '../fileExclusion';
import { mock } from './utils';

suite('fileExclusion', () => {
	let mockConfiguration: vscode.WorkspaceConfiguration;
	let getConfigurationStub: sinon.SinonStub;

	setup(() => {
		mockConfiguration = mock<vscode.WorkspaceConfiguration>({
			get: sinon.stub() as any,
			inspect: sinon.stub() as any
		});
		getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration);
	});

	teardown(() => {
		sinon.restore();
	});

	suite('isFileExcludedFromAI', () => {
		test('should return false when no patterns are configured', () => {
			(mockConfiguration.get as sinon.SinonStub).withArgs('aiExcludes').returns([]);
			(mockConfiguration.inspect as sinon.SinonStub).withArgs('aiExcludes').returns({
				globalValue: [],
				workspaceValue: undefined
			});

			const uri = vscode.Uri.file('/project/src/file.py');
			assert.strictEqual(isFileExcludedFromAI(uri), false);
		});

		test('should return false when patterns is undefined', () => {
			(mockConfiguration.get as sinon.SinonStub).withArgs('aiExcludes').returns(undefined);
			(mockConfiguration.inspect as sinon.SinonStub).withArgs('aiExcludes').returns({
				globalValue: undefined,
				workspaceValue: undefined
			});
			(mockConfiguration.get as sinon.SinonStub).withArgs('inlineCompletionExcludes').returns(undefined);

			const uri = vscode.Uri.file('/project/src/file.py');
			assert.strictEqual(isFileExcludedFromAI(uri), false);
		});

		suite('basename matching (patterns without /)', () => {
			test('*.py should match any Python file at any depth', () => {
				(mockConfiguration.get as sinon.SinonStub).withArgs('aiExcludes').returns(['*.py']);
				(mockConfiguration.inspect as sinon.SinonStub).withArgs('aiExcludes').returns({
					globalValue: ['*.py'],
					workspaceValue: undefined
				});

				// Root level
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/file.py')), true);
				// Nested
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/src/file.py')), true);
				// Deeply nested
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/src/deep/nested/file.py')), true);
				// Non-Python file should not match
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/file.js')), false);
			});

			test('secret.txt should match any file named secret.txt at any depth', () => {
				(mockConfiguration.get as sinon.SinonStub).withArgs('aiExcludes').returns(['secret.txt']);
				(mockConfiguration.inspect as sinon.SinonStub).withArgs('aiExcludes').returns({
					globalValue: ['secret.txt'],
					workspaceValue: undefined
				});

				// Root level
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/secret.txt')), true);
				// Nested
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/config/secret.txt')), true);
				// Different filename should not match
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/other.txt')), false);
			});

			test('**/.*  should match dotfiles at any level', () => {
				(mockConfiguration.get as sinon.SinonStub).withArgs('aiExcludes').returns(['**/.*']);
				(mockConfiguration.inspect as sinon.SinonStub).withArgs('aiExcludes').returns({
					globalValue: ['**/.*'],
					workspaceValue: undefined
				});

				// Root level dotfile
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/.env')), true);
				// Nested dotfile
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/config/.secret')), true);
				// Normal file should not match
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/normal.txt')), false);
			});

			test('.* (without **/) should match any dotfile at any depth', () => {
				(mockConfiguration.get as sinon.SinonStub).withArgs('aiExcludes').returns(['.*']);
				(mockConfiguration.inspect as sinon.SinonStub).withArgs('aiExcludes').returns({
					globalValue: ['.*'],
					workspaceValue: undefined
				});

				// Root level dotfile
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/.env')), true);
				// Nested dotfile
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/deep/.gitignore')), true);
				// Normal file should not match
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/normal.txt')), false);
			});
		});

		suite('path matching (patterns with /)', () => {
			test('**/*.py should match Python files at any depth (backwards compatible)', () => {
				(mockConfiguration.get as sinon.SinonStub).withArgs('aiExcludes').returns(['**/*.py']);
				(mockConfiguration.inspect as sinon.SinonStub).withArgs('aiExcludes').returns({
					globalValue: ['**/*.py'],
					workspaceValue: undefined
				});

				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/src/file.py')), true);
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/deep/nested/file.py')), true);
			});

			test('src/*.py matches against full path (requires full path match)', () => {
				(mockConfiguration.get as sinon.SinonStub).withArgs('aiExcludes').returns(['src/*.py']);
				(mockConfiguration.inspect as sinon.SinonStub).withArgs('aiExcludes').returns({
					globalValue: ['src/*.py'],
					workspaceValue: undefined
				});

				// Note: patterns with / match against full path including leading /
				// So src/*.py won't match /project/src/file.py
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/src/file.py')), false);
				// User should use **/src/*.py for recursive matching
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/src/nested/file.py')), false);
			});

			test('**/src/*.py should match src directories at any depth', () => {
				(mockConfiguration.get as sinon.SinonStub).withArgs('aiExcludes').returns(['**/src/*.py']);
				(mockConfiguration.inspect as sinon.SinonStub).withArgs('aiExcludes').returns({
					globalValue: ['**/src/*.py'],
					workspaceValue: undefined
				});

				// Should match file in any src/ directory
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/src/file.py')), true);
				// Should NOT match nested files within src
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/src/nested/file.py')), false);
				// Should NOT match non-python files in src
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/src/file.js')), false);
			});

			test('**/config/secrets/* should match config/secrets directories at any depth', () => {
				(mockConfiguration.get as sinon.SinonStub).withArgs('aiExcludes').returns(['**/config/secrets/*']);
				(mockConfiguration.inspect as sinon.SinonStub).withArgs('aiExcludes').returns({
					globalValue: ['**/config/secrets/*'],
					workspaceValue: undefined
				});

				// Should match files in config/secrets/
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/config/secrets/api.key')), true);
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/config/secrets/password.txt')), true);
				// Should NOT match files in other directories
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/config/settings.json')), false);
			});
		});

		suite('fallback to inlineCompletionExcludes', () => {
			test('should use inlineCompletionExcludes when aiExcludes is not explicitly set', () => {
				(mockConfiguration.get as sinon.SinonStub).withArgs('aiExcludes').returns(['*.py']);
				(mockConfiguration.inspect as sinon.SinonStub).withArgs('aiExcludes').returns({
					globalValue: undefined,
					workspaceValue: undefined
				});
				(mockConfiguration.get as sinon.SinonStub).withArgs('inlineCompletionExcludes').returns(['*.env']);

				// Should use the fallback pattern
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/.env')), true);
				// The aiExcludes default should be ignored
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/file.py')), false);
			});
		});

		suite('multiple patterns', () => {
			test('should match if any pattern matches', () => {
				(mockConfiguration.get as sinon.SinonStub).withArgs('aiExcludes').returns(['*.py', '*.env', 'secret.txt']);
				(mockConfiguration.inspect as sinon.SinonStub).withArgs('aiExcludes').returns({
					globalValue: ['*.py', '*.env', 'secret.txt'],
					workspaceValue: undefined
				});

				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/file.py')), true);
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/.env')), true);
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/config/secret.txt')), true);
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/file.js')), false);
			});
		});
	});
});
