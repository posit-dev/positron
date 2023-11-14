/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { parseTestsFromFile } from './parser';
import { ItemType, TestingTools } from './util-testing';
import { testthatTestFilePattern } from './watcher';

import { Logger } from '../extension';

export async function discoverTestFiles(testingTools: TestingTools) {
	if (!vscode.workspace.workspaceFolders) {
		Logger.info('No open workspace; no test discovery.');
		return;
	}

	return Promise.all(
		vscode.workspace.workspaceFolders.map(async (workspaceFolder) => {
			Logger.info(`Discovering testthat test files in ${workspaceFolder.uri}`);
			const pattern = new vscode.RelativePattern(workspaceFolder, testthatTestFilePattern);
			for (const file of await vscode.workspace.findFiles(pattern)) {
				getOrCreateFileItem(testingTools, file);
			}
		})
	);
}

export function getOrCreateFileItem(testingTools: TestingTools, uri: vscode.Uri) {
	const existing = testingTools.controller.items.get(uri.path);
	if (existing) {
		Logger.info(`Found a file node for ${uri}`);
		return existing;
	}

	Logger.info(`Creating a file node for ${uri}`);
	// TODO (maybe): it bugs me that the ID for a file testItem is uri.path, but we process the path
	// even more and differently when creating the ID for a child, i.e. for a test within that file
	const file = testingTools.controller.createTestItem(uri.path, uri.path.split('/').pop()!, uri);
	testingTools.testItemData.set(file, ItemType.File);
	file.canResolveChildren = true;
	testingTools.controller.items.add(file);

	return file;
}

export async function loadTestsFromFile(testingTools: TestingTools, test: vscode.TestItem) {
	Logger.info(`Loading tests from file ${test.uri}`);

	let tests;
	try {
		test.busy = true;
		tests = parseTestsFromFile(testingTools, test);
		test.busy = false;
	} catch (error) {
		test.busy = false;
		test.error = String(error);
		Logger.error(`Parsing test file errored with reason: ${error}`);
		tests = undefined;
	}

	return tests;
}
