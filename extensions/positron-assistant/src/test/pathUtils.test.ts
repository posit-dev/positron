/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as sinon from 'sinon';
import { isRelativePath, resolvePathAgainstWorkspace, resolveApplyPatchPaths, resolveToolInputPaths } from '../pathUtils';

suite('Path Utils', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('isRelativePath', () => {
		test('identifies relative paths', () => {
			assert.strictEqual(isRelativePath('test.R'), true);
			assert.strictEqual(isRelativePath('src/file.py'), true);
			assert.strictEqual(isRelativePath('./file.js'), true);
			assert.strictEqual(isRelativePath('../data/file.csv'), true);
			assert.strictEqual(isRelativePath('folder/subfolder/file.txt'), true);
		});

		test('identifies absolute POSIX paths', () => {
			assert.strictEqual(isRelativePath('/Users/foo/test.R'), false);
			assert.strictEqual(isRelativePath('/home/user/file.py'), false);
			assert.strictEqual(isRelativePath('/absolute/path'), false);
		});

		test('identifies absolute Windows paths', () => {
			assert.strictEqual(isRelativePath('C:\\Users\\foo\\test.R'), false);
			assert.strictEqual(isRelativePath('D:\\data\\file.csv'), false);
			assert.strictEqual(isRelativePath('c:/Users/foo/test.R'), false); // Mixed separators
		});

		test('identifies URI schemes', () => {
			assert.strictEqual(isRelativePath('file:///path/to/file'), false);
			assert.strictEqual(isRelativePath('vscode://file/path'), false);
			assert.strictEqual(isRelativePath('http://example.com'), false);
			assert.strictEqual(isRelativePath('https://example.com/file'), false);
		});

		test('handles edge cases', () => {
			assert.strictEqual(isRelativePath(''), false);
			assert.strictEqual(isRelativePath('   '), false);
		});
	});

	suite('resolvePathAgainstWorkspace', () => {
		test('returns absolute paths unchanged', () => {
			const absolutePath = '/Users/foo/test.R';
			assert.strictEqual(resolvePathAgainstWorkspace(absolutePath), absolutePath);
		});

		test('returns Windows absolute paths unchanged', () => {
			const windowsPath = 'C:\\Users\\foo\\test.R';
			assert.strictEqual(resolvePathAgainstWorkspace(windowsPath), windowsPath);
		});

		test('returns URIs unchanged', () => {
			const uri = 'file:///Users/foo/test.R';
			assert.strictEqual(resolvePathAgainstWorkspace(uri), uri);
		});

		test('resolves relative path against workspace root', () => {
			const workspaceUri = vscode.Uri.file('/workspace/root');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([
				{ uri: workspaceUri, name: 'test', index: 0 }
			]);

			const result = resolvePathAgainstWorkspace('test.R');
			const expected = path.join('/workspace/root', 'test.R');
			assert.strictEqual(result, expected);
		});

		test('resolves nested relative paths', () => {
			const workspaceUri = vscode.Uri.file('/workspace/root');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([
				{ uri: workspaceUri, name: 'test', index: 0 }
			]);

			const result = resolvePathAgainstWorkspace('src/utils/helper.ts');
			const expected = path.join('/workspace/root', 'src/utils/helper.ts');
			assert.strictEqual(result, expected);
		});

		test('resolves paths with ./ prefix', () => {
			const workspaceUri = vscode.Uri.file('/workspace/root');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([
				{ uri: workspaceUri, name: 'test', index: 0 }
			]);

			const result = resolvePathAgainstWorkspace('./test.R');
			const expected = path.join('/workspace/root', 'test.R');
			assert.strictEqual(result, expected);
		});

		test('resolves paths with ../ prefix', () => {
			const workspaceUri = vscode.Uri.file('/workspace/root');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([
				{ uri: workspaceUri, name: 'test', index: 0 }
			]);

			const result = resolvePathAgainstWorkspace('../test.R');
			const expected = path.resolve('/workspace/root', '../test.R');
			assert.strictEqual(result, expected);
		});

		test('returns undefined when no workspace is open', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);
			assert.strictEqual(resolvePathAgainstWorkspace('test.R'), undefined);
		});

		test('returns undefined when workspace folders array is empty', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([]);
			assert.strictEqual(resolvePathAgainstWorkspace('test.R'), undefined);
		});

		test('uses first workspace folder in multi-root workspace', () => {
			const workspaceUri1 = vscode.Uri.file('/workspace/root1');
			const workspaceUri2 = vscode.Uri.file('/workspace/root2');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([
				{ uri: workspaceUri1, name: 'test1', index: 0 },
				{ uri: workspaceUri2, name: 'test2', index: 1 }
			]);

			const result = resolvePathAgainstWorkspace('test.R');
			const expected = path.join('/workspace/root1', 'test.R');
			assert.strictEqual(result, expected);
		});
	});

	suite('resolveApplyPatchPaths', () => {
		test('resolves relative paths on Add File lines', () => {
			const workspaceUri = vscode.Uri.file('/workspace/root');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([
				{ uri: workspaceUri, name: 'test', index: 0 }
			]);

			const patch = '*** Begin Patch\n*** Add File: test.R\n+content\n*** End Patch';
			const result = resolveApplyPatchPaths(patch);

			const expected = path.join('/workspace/root', 'test.R');
			assert.ok(result.includes(`*** Add File: ${expected}`), `Got: ${result}`);
		});

		test('resolves relative paths on Update File lines', () => {
			const workspaceUri = vscode.Uri.file('/workspace/root');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([
				{ uri: workspaceUri, name: 'test', index: 0 }
			]);

			const patch = '*** Begin Patch\n*** Update File: src/app.ts\n@@ fn\n-old\n+new\n*** End Patch';
			const result = resolveApplyPatchPaths(patch);

			const expected = path.join('/workspace/root', 'src/app.ts');
			assert.ok(result.includes(`*** Update File: ${expected}`), `Got: ${result}`);
		});

		test('resolves relative paths on Delete File and Move to lines', () => {
			const workspaceUri = vscode.Uri.file('/workspace/root');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([
				{ uri: workspaceUri, name: 'test', index: 0 }
			]);

			const patch = '*** Begin Patch\n*** Delete File: old.R\n*** Move to: new.R\n*** End Patch';
			const result = resolveApplyPatchPaths(patch);

			const expectedDelete = path.join('/workspace/root', 'old.R');
			const expectedMove = path.join('/workspace/root', 'new.R');
			assert.ok(result.includes(`*** Delete File: ${expectedDelete}`), `Got: ${result}`);
			assert.ok(result.includes(`*** Move to: ${expectedMove}`), `Got: ${result}`);
		});

		test('preserves absolute paths unchanged', () => {
			const workspaceUri = vscode.Uri.file('/workspace/root');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([
				{ uri: workspaceUri, name: 'test', index: 0 }
			]);

			const patch = '*** Begin Patch\n*** Add File: /absolute/path/test.R\n+content\n*** End Patch';
			const result = resolveApplyPatchPaths(patch);

			assert.ok(result.includes('*** Add File: /absolute/path/test.R'), `Got: ${result}`);
		});

		test('leaves non-path lines unchanged', () => {
			const workspaceUri = vscode.Uri.file('/workspace/root');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([
				{ uri: workspaceUri, name: 'test', index: 0 }
			]);

			const patch = '*** Begin Patch\n*** Add File: test.R\n+content line\n-removed line\n*** End Patch';
			const result = resolveApplyPatchPaths(patch);

			assert.ok(result.includes('+content line'), `Got: ${result}`);
			assert.ok(result.includes('-removed line'), `Got: ${result}`);
		});
	});

	suite('resolveToolInputPaths', () => {
		test('does not modify non-Copilot tools', () => {
			const input = { filePath: 'test.R' };
			const result = resolveToolInputPaths('some_other_tool', input);
			assert.strictEqual(result, input);
			assert.strictEqual(result.filePath, 'test.R');
		});

		test('resolves copilot_createFile paths', () => {
			const workspaceUri = vscode.Uri.file('/workspace/root');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([
				{ uri: workspaceUri, name: 'test', index: 0 }
			]);

			const input = { filePath: 'test.R', content: 'print("hello")' };
			const result = resolveToolInputPaths('copilot_createFile', input);

			const expected = path.join('/workspace/root', 'test.R');
			assert.strictEqual(result.filePath, expected);
			assert.strictEqual(result.content, 'print("hello")');
		});

		test('resolves copilot_readFile paths', () => {
			const workspaceUri = vscode.Uri.file('/workspace/root');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([
				{ uri: workspaceUri, name: 'test', index: 0 }
			]);

			const input = { filePath: 'src/utils.ts', offset: 10, limit: 100 };
			const result = resolveToolInputPaths('copilot_readFile', input);

			const expected = path.join('/workspace/root', 'src/utils.ts');
			assert.strictEqual(result.filePath, expected);
			assert.strictEqual(result.offset, 10);
			assert.strictEqual(result.limit, 100);
		});

		test('preserves absolute paths in copilot_createFile', () => {
			const workspaceUri = vscode.Uri.file('/workspace/root');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([
				{ uri: workspaceUri, name: 'test', index: 0 }
			]);

			const input = { filePath: '/absolute/path/test.R', content: 'test' };
			const result = resolveToolInputPaths('copilot_createFile', input);

			assert.strictEqual(result.filePath, '/absolute/path/test.R');
		});

		test('returns original input when no workspace is open', () => {
			sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

			const input = { filePath: 'test.R', content: 'test' };
			const result = resolveToolInputPaths('copilot_createFile', input);

			// Should return original input unchanged
			assert.strictEqual(result.filePath, 'test.R');
		});

		test('resolves relative paths in copilot_applyPatch input string', () => {
			const workspaceUri = vscode.Uri.file('/workspace/root');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([
				{ uri: workspaceUri, name: 'test', index: 0 }
			]);

			const patchInput = '*** Begin Patch\n*** Add File: test.R\n+print("hello")\n*** End Patch';
			const input = { input: patchInput, explanation: 'Adding test file' };
			const result = resolveToolInputPaths('copilot_applyPatch', input);

			const expectedPath = path.join('/workspace/root', 'test.R');
			assert.ok(result.input.includes(`*** Add File: ${expectedPath}`), `Expected resolved path in patch, got: ${result.input}`);
			assert.strictEqual(result.explanation, 'Adding test file');
		});

		test('preserves absolute paths in copilot_applyPatch input string', () => {
			const workspaceUri = vscode.Uri.file('/workspace/root');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([
				{ uri: workspaceUri, name: 'test', index: 0 }
			]);

			const patchInput = '*** Begin Patch\n*** Update File: /absolute/path/test.R\n@@ fn\n-old\n+new\n*** End Patch';
			const input = { input: patchInput, explanation: 'Updating test file' };
			const result = resolveToolInputPaths('copilot_applyPatch', input);

			assert.ok(result.input.includes('*** Update File: /absolute/path/test.R'), `Absolute path should be preserved, got: ${result.input}`);
		});

		test('handles missing filePath gracefully', () => {
			const workspaceUri = vscode.Uri.file('/workspace/root');
			sandbox.stub(vscode.workspace, 'workspaceFolders').value([
				{ uri: workspaceUri, name: 'test', index: 0 }
			]);

			const input = { content: 'test' }; // Missing filePath
			const result = resolveToolInputPaths('copilot_createFile', input);

			assert.strictEqual(result, input);
		});

		test('handles null/undefined input gracefully', () => {
			const result1 = resolveToolInputPaths('copilot_createFile', null);
			const result2 = resolveToolInputPaths('copilot_createFile', undefined);

			assert.strictEqual(result1, null);
			assert.strictEqual(result2, undefined);
		});
	});
});
