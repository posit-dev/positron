/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ItemType, TestingTools } from './util-testing';
import { discoverTestFiles, loadTestsFromFile } from './loader';
import { createTestthatWatchers } from './watcher';
import { runHandler } from './runner';
import { Logger } from '../extension';

let controller: vscode.TestController | undefined;

export async function setupTestExplorer(context: vscode.ExtensionContext) {
	if (testExplorerEnabled()) {
		return discoverTests(context);
	}
}

export function refreshTestExplorer(context: vscode.ExtensionContext) {
	const enabled = testExplorerEnabled();
	const inPlace = hasTestingController();

	if ((enabled && inPlace) || (!enabled && !inPlace)) {
		return;
	}

	if (enabled) {
		return discoverTests(context);
	}

	controller?.dispose();
	controller = undefined;
}

function testExplorerEnabled(): boolean {
	const extConfig = vscode.workspace.getConfiguration('positron.r');
	const testingEnabled = extConfig.get<boolean>('testing');

	return testingEnabled === true;
}

function hasTestingController(): boolean {
	return controller !== undefined;
}

export function discoverTests(context: vscode.ExtensionContext) {
	// TODO: check workspace folder(s) for package-hood
	// if no package, return
	// if exactly one package among the workspace folders, proceed
	// consider adding package metadata to testingTools (eg name and filepath)
	// if >1 package, consult our non-existent policy re: multi-root, multi-package workspace

	controller = vscode.tests.createTestController(
		'rPackageTests',
		'R Package Test Explorer'
	);
	context.subscriptions.push(controller);

	const testItemData = new WeakMap<vscode.TestItem, ItemType>();
	const testingTools: TestingTools = {
		controller,
		testItemData,
	};

	// The first time this is called, `test` is undefined, therefore we do full file discovery and
	// set up file watchers for the future.
	// In subsequent calls, `test` will refer to a test file.
	controller.resolveHandler = async (test) => {
		if (test) {
			await loadTestsFromFile(testingTools, test);
		} else {
			await discoverTestFiles(testingTools);
			const watchers = await createTestthatWatchers(testingTools);
			for (const watcher of watchers) {
				context.subscriptions.push(watcher);
			}
			Logger.info('Testthat file watchers are in place.');
		}
	};

	// We'll create the "run" type profile here, and give it the function to call.
	// You can also create debug and coverage profile types. The last `true` argument
	// indicates that this should by the default "run" profile, in case there were
	// multiple run profiles.
	controller.createRunProfile(
		'Run',
		vscode.TestRunProfileKind.Run,
		(request, token) => runHandler(testingTools, request, token),
		true
	);
}
