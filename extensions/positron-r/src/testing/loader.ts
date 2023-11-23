/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../extension';
import { parseTestsFromFile } from './parser';
import { ItemType, TestingTools, encodeNodeId } from './util-testing';
import { testthatTestFilePattern } from './watcher';

export async function discoverTestFiles(testingTools: TestingTools) {
	const packageRoot = testingTools.packageRoot;
	Logger.info(`Discovering testthat test files in ${packageRoot.path}`);
	const pattern = new vscode.RelativePattern(packageRoot, testthatTestFilePattern);
	for (const file of await vscode.workspace.findFiles(pattern)) {
		getOrCreateFileItem(testingTools, file);
	}
}

export function getOrCreateFileItem(testingTools: TestingTools, uri: vscode.Uri) {
	const testFile = path.basename(uri.fsPath);
	const existing = testingTools.controller.items.get(encodeNodeId(testFile));
	if (existing) {
		Logger.info(`Found a file node for ${testFile}`);
		return existing;
	}

	Logger.info(`Creating a file node for ${testFile}`);
	const item = testingTools.controller.createTestItem(encodeNodeId(testFile), testFile, uri);
	testingTools.testItemData.set(item, ItemType.File);
	item.canResolveChildren = true;
	testingTools.controller.items.add(item);

	return item;
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
