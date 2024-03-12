/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { TestingTools } from './util-testing';
import { getOrCreateFileItem } from './loader';
import { parseTestsFromFile } from './parser';
import { LOGGER } from '../extension';
import { detectRPackage } from '../contexts';
import { getFirstWorkspaceFolder } from './testing';

const testsPattern = 'tests';
const testthatDotRPattern = 'tests/testthat.[Rr]';
export const testthatTestFilePattern = 'tests/testthat/test*.[Rr]';

export async function createTestthatWatchers(testingTools: TestingTools): Promise<vscode.FileSystemWatcher[]> {
	const packageRoot = testingTools.packageRoot;
	LOGGER.info(`Constructing testthat file watchers for ${packageRoot.path}`);
	const watchers = await createWatchers(testingTools, packageRoot);
	return watchers.flat();
}

async function createWatchers(testingTools: TestingTools, packageRoot: vscode.Uri) {
	// watch tests/testthat.R to determine if package uses testthat
	const dotRPattern = new vscode.RelativePattern(packageRoot, testthatDotRPattern);
	const dotRWatcher = vscode.workspace.createFileSystemWatcher(dotRPattern);

	dotRWatcher.onDidCreate((uri) => {
		refreshTestthatStatus();
	});
	dotRWatcher.onDidDelete((uri) => {
		refreshTestthatStatus();
	});

	// watch for deletion of tests/ as a 2nd way to detect deletion of tests/testthat.R
	// workaround for https://github.com/microsoft/vscode/issues/109754
	const folderPattern = new vscode.RelativePattern(packageRoot, testsPattern);
	const folderWatcher = vscode.workspace.createFileSystemWatcher(folderPattern);

	folderWatcher.onDidDelete((uri) => {
		refreshTestthatStatus();
	});

	// watch testthat test files to support test explorer
	const testFilePattern = new vscode.RelativePattern(packageRoot, testthatTestFilePattern);
	const testFileWatcher = vscode.workspace.createFileSystemWatcher(testFilePattern);

	testFileWatcher.onDidCreate((uri) => {
		getOrCreateFileItem(testingTools, uri);
		// important to know when we go from 0 to 1 test file
		refreshTestthatStatus();
	});
	testFileWatcher.onDidChange((uri) => parseTestsFromFile(testingTools, getOrCreateFileItem(testingTools, uri)));
	testFileWatcher.onDidDelete((uri) => {
		testingTools.controller.items.delete(uri.path);
		// important to know if there are no test files left
		refreshTestthatStatus();
	});

	return [dotRWatcher, folderWatcher, testFileWatcher];
}

export async function refreshTestthatStatus(): Promise<void> {
	let testthatIsConfigured = false;
	let testthatHasTests = false;
	LOGGER.info('Refreshing testthat status');

	try {
		const isRPackage = await detectRPackage();
		if (!isRPackage) {
			LOGGER.info('Not working in an R package');
			return;
		}

		const packageRoot = await getFirstWorkspaceFolder();
		// we know packageRoot can't be null, but typescript doesn't know that, so check again
		if (!packageRoot) {
			return;
		}

		const dotRPattern = new vscode.RelativePattern(packageRoot, testthatDotRPattern);
		const testthatDotR = await vscode.workspace.findFiles(dotRPattern, null, 1);
		if (testthatDotR.length === 0) {
			LOGGER.info('tests/testthat.R not found');
			return;
		}
		LOGGER.info('found testthat.R');
		testthatIsConfigured = true;

		const testFilePattern = new vscode.RelativePattern(packageRoot, testthatTestFilePattern);
		const testFiles = await vscode.workspace.findFiles(testFilePattern, null, 1);
		LOGGER.info(`found ${testFiles.length} test files`);
		testthatHasTests = testFiles.length > 0;
	} finally {
		vscode.commands.executeCommand('setContext', 'testthatIsConfigured', testthatIsConfigured);
		vscode.commands.executeCommand('setContext', 'testthatHasTests', testthatHasTests);
		LOGGER.info(`Context key 'testthatIsConfigured' is '${testthatIsConfigured}'`);
		LOGGER.info(`Context key 'testthatHasTests' is '${testthatHasTests}'`);
	}
}
