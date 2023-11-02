/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { match } from 'minimatch';
import { TestingTools, testthatFilePattern } from './util-testing';
import { getOrCreateFileItem } from './loader';
import { parseTestsFromFile } from './parser';
import { Logger } from '../extension';

export async function createTestthatWatchers(testingTools: TestingTools) {
	if (!vscode.workspace.workspaceFolders) {
		Logger.info('No open workspace; no test file watchers.');
		return [];
	}

	return Promise.all(
		vscode.workspace.workspaceFolders.map(async (workspaceFolder) => {
			Logger.info(`Constructing testthat file watcher for ${workspaceFolder.uri}`);
			const watcher = await createTestthatWatcher(testingTools, workspaceFolder);
			return watcher;
		})
	);
}

async function createTestthatWatcher(
	testingTools: TestingTools,
	workspaceFolder: vscode.WorkspaceFolder
) {
	const pattern = new vscode.RelativePattern(workspaceFolder, testthatFilePattern);
	const watcher = vscode.workspace.createFileSystemWatcher(pattern);

	// Check that tests are not from RCMD and are not temp files
	const RCMDpattern = '**/check/*.Rcheck/**';
	const isValid = (uri: vscode.Uri) =>
		match([uri.path], RCMDpattern).length === 0;

	watcher.onDidCreate((uri) => (isValid(uri) ? getOrCreateFileItem(testingTools, uri) : undefined));
	watcher.onDidChange((uri) =>
		isValid(uri)
			? parseTestsFromFile(testingTools, getOrCreateFileItem(testingTools, uri))
			: undefined
	);
	watcher.onDidDelete((uri) =>
		isValid(uri) ? testingTools.controller.items.delete(uri.path) : undefined
	);

	return watcher;
}

