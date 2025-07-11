/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { substituteVariables } from '../variableSubstitution';

suite('Variable Substitution', () => {

	const mockWorkspaceFolder1 = {
		uri: vscode.Uri.file('/workspace/project1'),
		name: 'project1',
		index: 0
	};

	const mockWorkspaceFolder2 = {
		uri: vscode.Uri.file('/workspace/project2'),
		name: 'project2',
		index: 1
	};

	const mockNotebookUri = vscode.Uri.file('/workspace/project1/notebooks/analysis.ipynb');

	// Mock vscode.workspace for testing
	let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;
	let originalGetWorkspaceFolder: typeof vscode.workspace.getWorkspaceFolder;

	suiteSetup(() => {
		// Store original values
		originalWorkspaceFolders = vscode.workspace.workspaceFolders;
		originalGetWorkspaceFolder = vscode.workspace.getWorkspaceFolder;
	});

	suiteTeardown(() => {
		// Restore original values
		Object.defineProperty(vscode.workspace, 'workspaceFolders', {
			value: originalWorkspaceFolders
		});
		vscode.workspace.getWorkspaceFolder = originalGetWorkspaceFolder;
	});

	setup(() => {
		// Setup mock workspace folders
		Object.defineProperty(vscode.workspace, 'workspaceFolders', {
			value: [mockWorkspaceFolder1, mockWorkspaceFolder2],
			configurable: true
		});

		vscode.workspace.getWorkspaceFolder = (uri: vscode.Uri) => {
			if (uri.fsPath.startsWith('/workspace/project1')) {
				return mockWorkspaceFolder1;
			}
			if (uri.fsPath.startsWith('/workspace/project2')) {
				return mockWorkspaceFolder2;
			}
			return undefined;
		};
	});

	test('Returns original value when no variables present', () => {
		const result = substituteVariables('/absolute/path/to/directory');
		assert.strictEqual(result, '/absolute/path/to/directory');
	});

	test('Returns empty string for empty input', () => {
		const result = substituteVariables('');
		assert.strictEqual(result, '');
	});

	test('Substitutes ${workspaceFolder} with first workspace folder', () => {
		const result = substituteVariables('${workspaceFolder}/data');
		assert.strictEqual(result, '/workspace/project1/data');
	});

	test('Substitutes ${workspaceFolder:name} with specific workspace folder', () => {
		const result = substituteVariables('${workspaceFolder:project2}/config');
		assert.strictEqual(result, '/workspace/project2/config');
	});

	test('Returns original text for non-existent workspace folder name', () => {
		const result = substituteVariables('${workspaceFolder:nonexistent}/path');
		assert.strictEqual(result, '${workspaceFolder:nonexistent}/path');
	});

	test('Substitutes ${fileDirname} with notebook directory', () => {
		const result = substituteVariables('${fileDirname}', mockNotebookUri);
		assert.strictEqual(result, '/workspace/project1/notebooks');
	});

	test('Substitutes ${file} with full notebook path', () => {
		const result = substituteVariables('${file}', mockNotebookUri);
		assert.strictEqual(result, '/workspace/project1/notebooks/analysis.ipynb');
	});

	test('Substitutes ${fileBasename} with notebook filename', () => {
		const result = substituteVariables('${fileBasename}', mockNotebookUri);
		assert.strictEqual(result, 'analysis.ipynb');
	});

	test('Substitutes ${fileBasenameNoExtension} with filename without extension', () => {
		const result = substituteVariables('${fileBasenameNoExtension}', mockNotebookUri);
		assert.strictEqual(result, 'analysis');
	});

	test('Substitutes ${fileExtname} with file extension', () => {
		const result = substituteVariables('${fileExtname}', mockNotebookUri);
		assert.strictEqual(result, '.ipynb');
	});

	test('Substitutes ${relativeFile} with relative path from workspace', () => {
		const result = substituteVariables('${relativeFile}', mockNotebookUri);
		assert.strictEqual(result, 'notebooks/analysis.ipynb');
	});

	test('Substitutes ${relativeFileDirname} with relative directory from workspace', () => {
		const result = substituteVariables('${relativeFileDirname}', mockNotebookUri);
		assert.strictEqual(result, 'notebooks');
	});

	test('Substitutes ${cwd} with current working directory', () => {
		const result = substituteVariables('${cwd}/temp');
		assert.strictEqual(result, `${process.cwd()}/temp`);
	});

	test('Substitutes ${userHome} with user home directory', () => {
		const result = substituteVariables('${userHome}/Documents');
		assert.strictEqual(result, `${os.homedir()}/Documents`);
	});

	test('Substitutes ${pathSeparator} with OS path separator', () => {
		const result = substituteVariables('path${pathSeparator}to${pathSeparator}file');
		assert.strictEqual(result, `path${path.sep}to${path.sep}file`);
	});

	test('Substitutes ${/} with OS path separator', () => {
		const result = substituteVariables('path${/}to${/}file');
		assert.strictEqual(result, `path${path.sep}to${path.sep}file`);
	});

	test('Substitutes ${env:VARIABLE_NAME} with environment variable', () => {
		const originalValue = process.env.TEST_VAR;
		process.env.TEST_VAR = 'test_value';
		
		try {
			const result = substituteVariables('${env:TEST_VAR}/path');
			assert.strictEqual(result, 'test_value/path');
		} finally {
			if (originalValue !== undefined) {
				process.env.TEST_VAR = originalValue;
			} else {
				delete process.env.TEST_VAR;
			}
		}
	});

	test('Returns empty string for non-existent environment variable', () => {
		const result = substituteVariables('${env:NON_EXISTENT_VAR}/path');
		assert.strictEqual(result, '/path');
	});

	test('Handles multiple variable substitutions', () => {
		const result = substituteVariables('${workspaceFolder}${pathSeparator}${fileDirname}', mockNotebookUri);
		assert.strictEqual(result, `/workspace/project1${path.sep}/workspace/project1/notebooks`);
	});

	test('Returns original text for unrecognized variables', () => {
		const result = substituteVariables('${unknownVariable}/path');
		assert.strictEqual(result, '${unknownVariable}/path');
	});

	test('Handles file variables without notebook URI gracefully', () => {
		const result = substituteVariables('${fileDirname}/fallback');
		assert.strictEqual(result, '${fileDirname}/fallback');
	});

	test('Handles workspace variables when no workspace folders exist', () => {
		// Temporarily remove workspace folders
		Object.defineProperty(vscode.workspace, 'workspaceFolders', {
			value: undefined,
			configurable: true
		});

		const result = substituteVariables('${workspaceFolder}/path');
		assert.strictEqual(result, '${workspaceFolder}/path');
	});

	test('Complex substitution scenario - VS Code compatibility', () => {
		// Test the VS Code equivalent: jupyter.notebookFileRoot = "${workspaceFolder}"
		const result = substituteVariables('${workspaceFolder}', mockNotebookUri);
		assert.strictEqual(result, '/workspace/project1');
	});

	test('Complex substitution scenario - default behavior', () => {
		// Test the default behavior: notebook.workingDirectory = "${fileDirname}"
		const result = substituteVariables('${fileDirname}', mockNotebookUri);
		assert.strictEqual(result, '/workspace/project1/notebooks');
	});

	test('Complex substitution scenario - multi-root workspace', () => {
		// Test multi-root workspace scenario
		const result = substituteVariables('${workspaceFolder:project2}${pathSeparator}shared');
		assert.strictEqual(result, `/workspace/project2${path.sep}shared`);
	});

});