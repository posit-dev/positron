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
			test('should use inlineCompletionExcludes when only the deprecated setting is explicitly set', () => {
				// User has not set aiExcludes — `.get` returns whatever the contributed default would be.
				(mockConfiguration.get as sinon.SinonStub).withArgs('aiExcludes').returns(['*.py']);
				(mockConfiguration.inspect as sinon.SinonStub).withArgs('aiExcludes').returns({
					globalValue: undefined,
					workspaceValue: undefined
				});
				// User has explicitly set inlineCompletionExcludes (migration case).
				(mockConfiguration.get as sinon.SinonStub).withArgs('inlineCompletionExcludes').returns(['*.env']);
				(mockConfiguration.inspect as sinon.SinonStub).withArgs('inlineCompletionExcludes').returns({
					globalValue: ['*.env'],
					workspaceValue: undefined
				});

				// Should use the explicitly-set deprecated pattern
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/.env')), true);
				// The aiExcludes default should be ignored
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/file.py')), false);
			});

			test('should NOT use inlineCompletionExcludes when neither setting is explicitly set (stock config)', () => {
				// Regression for issue #13544: stock-config users were getting the deprecated
				// setting's `**/.*` default instead of the new aiExcludes default.
				(mockConfiguration.get as sinon.SinonStub).withArgs('aiExcludes').returns(['*.py']);
				(mockConfiguration.inspect as sinon.SinonStub).withArgs('aiExcludes').returns({
					globalValue: undefined,
					workspaceValue: undefined
				});
				(mockConfiguration.get as sinon.SinonStub).withArgs('inlineCompletionExcludes').returns(['**/.*']);
				(mockConfiguration.inspect as sinon.SinonStub).withArgs('inlineCompletionExcludes').returns({
					globalValue: undefined,
					workspaceValue: undefined
				});

				// Should use the aiExcludes default (*.py), not the deprecated default (**/.*).
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/file.py')), true);
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/.github/foo.yml')), false);
				assert.strictEqual(isFileExcludedFromAI(vscode.Uri.file('/project/.env')), false);
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

		suite('default patterns', () => {
			// Keep in sync with positron.assistant.aiExcludes default in package.json.
			const defaultPatterns = [
				'**/.env',
				'**/.env.*',
				'**/*.pem',
				'**/*.key',
				'**/*.p12',
				'**/*.pfx',
				'**/*.jks',
				'**/*.keystore',
				'**/id_rsa',
				'**/id_dsa',
				'**/id_ecdsa',
				'**/id_ecdsa_sk',
				'**/id_ed25519',
				'**/id_ed25519_sk',
				'**/.git-credentials',
				'**/.npmrc',
				'**/.pypirc',
				'**/.netrc',
				'**/.Renviron',
				'**/.aws/config',
				'**/.aws/credentials',
				'**/.docker/config.json',
				'**/.kube/config',
				'**/application_default_credentials.json',
				'**/.azure/accessTokens.json',
				'**/.azure/accessToken.json',
				'**/.azure/msal_token_cache.json',
				'**/.azure/msal_token_cache.bin',
				'**/secrets.*',
				'**/.git/**',
				'**/.svn/**',
				'**/.hg/**',
				'**/.DS_Store',
			];

			setup(() => {
				// Simulate stock config: user has not set either key. VS Code's
				// `.get()` returns the contributed default; `.inspect()` reports
				// undefined user/workspace values.
				(mockConfiguration.get as sinon.SinonStub).withArgs('aiExcludes').returns(defaultPatterns);
				(mockConfiguration.inspect as sinon.SinonStub).withArgs('aiExcludes').returns({
					globalValue: undefined,
					workspaceValue: undefined
				});
				(mockConfiguration.get as sinon.SinonStub).withArgs('inlineCompletionExcludes').returns(['**/.*']);
				(mockConfiguration.inspect as sinon.SinonStub).withArgs('inlineCompletionExcludes').returns({
					globalValue: undefined,
					workspaceValue: undefined
				});
			});

			test('excludes sensitive files', () => {
				const excluded = [
					// env
					'/project/.env',
					'/project/.env.local',
					'/project/.env.production',
					// keys / certs / keystores
					'/project/certs/server.pem',
					'/project/certs/server.key',
					'/project/cert.p12',
					'/project/cert.pfx',
					'/project/keystore.jks',
					'/project/my.keystore',
					// SSH keys (incl. extra variants)
					'/home/user/.ssh/id_rsa',
					'/home/user/.ssh/id_dsa',
					'/home/user/.ssh/id_ecdsa',
					'/home/user/.ssh/id_ecdsa_sk',
					'/home/user/.ssh/id_ed25519',
					'/home/user/.ssh/id_ed25519_sk',
					// package manager / registry auth
					'/home/user/.git-credentials',
					'/project/.npmrc',
					'/home/user/.pypirc',
					'/home/user/.netrc',
					// language runtime configs
					'/home/user/.Renviron',
					// cloud / container creds
					'/home/user/.aws/config',
					'/home/user/.aws/credentials',
					'/home/user/.docker/config.json',
					'/home/user/.kube/config',
					'/home/user/.config/gcloud/application_default_credentials.json',
					'/home/user/.azure/accessTokens.json',
					'/home/user/.azure/accessToken.json',
					'/home/user/.azure/msal_token_cache.json',
					'/home/user/.azure/msal_token_cache.bin',
					// generic secret-named
					'/project/secrets.yml',
					// VCS internals
					'/project/.git/config',
					'/project/.git/objects/pack/pack-abc.idx',
					'/project/.svn/entries',
					'/project/.hg/store/00manifest.i',
					// OS metadata
					'/project/.DS_Store',
					'/project/src/.DS_Store',
				];
				for (const filePath of excluded) {
					assert.strictEqual(
						isFileExcludedFromAI(vscode.Uri.file(filePath)),
						true,
						`expected ${filePath} to be excluded`,
					);
				}
			});

			test('allows project metadata, data files, and dependency sources', () => {
				const allowed = [
					'/project/.github/workflows/ci.yml',
					'/project/.gitignore',
					'/project/.gitattributes',
					'/project/.vscode/settings.json',
					'/project/.eslintrc.json',
					'/project/.prettierrc',
					'/project/.editorconfig',
					'/project/.positai/plan.md',
					'/project/data.csv',
					'/project/data/sample.parquet',
					'/project/report.xlsx',
					'/project/plot.png',
					'/project/notebook.ipynb',
					'/project/node_modules/pandas/core.py',
					'/project/.venv/lib/python3.11/site-packages/numpy/__init__.py',
				];
				for (const filePath of allowed) {
					assert.strictEqual(
						isFileExcludedFromAI(vscode.Uri.file(filePath)),
						false,
						`expected ${filePath} to be allowed`,
					);
				}
			});
		});
	});
});
