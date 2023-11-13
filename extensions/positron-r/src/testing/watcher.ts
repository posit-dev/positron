/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { TestingTools } from './util-testing';
import { getOrCreateFileItem } from './loader';
import { parseTestsFromFile } from './parser';
import { Logger } from '../extension';
import { detectRPackage } from '../contexts';

const testsPattern = '**/tests';
const testthatDotRPattern = '**/tests/testthat.[Rr]';
export const testthatTestFilePattern = '**/tests/testthat/test*.[Rr]';

export async function createTestthatWatchers(testingTools: TestingTools): Promise<vscode.FileSystemWatcher[]> {
	if (!vscode.workspace.workspaceFolders) {
		Logger.info('No open workspace; no test file watchers.');
		return [];
	}

	const watchers = await Promise.all(
		vscode.workspace.workspaceFolders.map(async (workspaceFolder) => {
			Logger.info(`Constructing testthat file watchers for ${workspaceFolder.uri}`);
			const watchers = await createWatchers(testingTools, workspaceFolder);
			return watchers;
		})
	);

	return watchers.flat();
}

async function createWatchers(
	testingTools: TestingTools,
	workspaceFolder: vscode.WorkspaceFolder
) {
	// watch tests/testthat.R to determine if package uses testthat
	const dotRPattern = new vscode.RelativePattern(workspaceFolder, testthatDotRPattern);
	const dotRWatcher = vscode.workspace.createFileSystemWatcher(dotRPattern);

	dotRWatcher.onDidCreate((uri) => {
		vscode.window.showInformationMessage('Detected creation of tests/testthat.R!');
		refreshTestthatStatus();
	});
	dotRWatcher.onDidDelete((uri) => {
		vscode.window.showInformationMessage('Detected deletion of tests/testthat.R!');
		refreshTestthatStatus();
	});

	// watch for deletion of tests/ as a 2nd way to detect deletion of tests/testthat.R
	// workaround for https://github.com/microsoft/vscode/issues/109754
	const folderPattern = new vscode.RelativePattern(workspaceFolder, testsPattern);
	const folderWatcher = vscode.workspace.createFileSystemWatcher(folderPattern);

	folderWatcher.onDidDelete((uri) => {
		vscode.window.showInformationMessage('Detected deletion of tests/ folder');
		refreshTestthatStatus();
	});

	// watch testthat test files to support test explorer
	const testFilePattern = new vscode.RelativePattern(workspaceFolder, testthatTestFilePattern);
	const testFileWatcher = vscode.workspace.createFileSystemWatcher(testFilePattern);

	testFileWatcher.onDidCreate((uri) => {
		vscode.window.showInformationMessage('Detected file creation!');
		getOrCreateFileItem(testingTools, uri);
		// important to know if we go from 0 to 1 test files
		refreshTestthatStatus();
	});
	testFileWatcher.onDidChange((uri) => parseTestsFromFile(testingTools, getOrCreateFileItem(testingTools, uri)));
	testFileWatcher.onDidDelete((uri) => {
		vscode.window.showInformationMessage('Detected file deletion!');
		testingTools.controller.items.delete(uri.path);
		// important to know if we drop to 1 test files
		refreshTestthatStatus();
	});

	return [dotRWatcher, folderWatcher, testFileWatcher];
}

export async function refreshTestthatStatus(): Promise<void> {
	let testthatIsConfigured = false;
	let testthatHasTests = false;
	Logger.info('refreshing testthat status');

	try {
		if (vscode.workspace.workspaceFolders === undefined) {
			Logger.info('no workspace folders');
			return;
		}

		const isRPackage = await detectRPackage();
		if (!isRPackage) {
			Logger.info('not an R package');
			return;
		}

		const workspaceFolder = vscode.workspace.workspaceFolders[0].uri;

		const dotRPattern = new vscode.RelativePattern(workspaceFolder, testthatDotRPattern);
		const testthatDotR = await vscode.workspace.findFiles(dotRPattern, null, 1);
		if ((testthatDotR).length === 0) {
			Logger.info('tests/testthat.R not found');
			return;
		}
		Logger.info('found testthat.R');
		testthatIsConfigured = true;

		const testFilePattern = new vscode.RelativePattern(workspaceFolder, testthatTestFilePattern);
		const testFiles = await vscode.workspace.findFiles(testFilePattern, null, 1);
		Logger.info(`found ${testFiles.length} test files`);
		testthatHasTests = testFiles.length > 0;
	} finally {
		vscode.commands.executeCommand('setContext', 'testthatIsConfigured', testthatIsConfigured);
		vscode.commands.executeCommand('setContext', 'testthatHasTests', testthatHasTests);
		Logger.info(`context key testthatIsConfigured set to ${testthatIsConfigured}`);
		Logger.info(`context key testthatHasTests set to ${testthatHasTests}`);
	}
}
