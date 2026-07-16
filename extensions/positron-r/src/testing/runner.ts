/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { runThatTest } from './runner-testthat';
import { ItemType, TestingTools } from './util-testing';
import { parseTestsFromFile } from './parser';
import { LOGGER } from '../extension';

// Paint the UI state of every leaf test under `item` as "queued", recursing through containers.
function markLeafTestsQueued(
	testingTools: TestingTools,
	item: vscode.TestItem,
	run: vscode.TestRun
) {
	if (item.children.size > 0) {
		item.children.forEach((child) => markLeafTestsQueued(testingTools, child, run));
	} else {
		const type = testingTools.testItemData.get(item);
		if (type === ItemType.TestThat || type === ItemType.It) {
			// Only mark a true leaf, not an empty container
			run.enqueued(item);
		}
	}
}

export async function runHandler(
	testingTools: TestingTools,
	request: vscode.TestRunRequest,
	token: vscode.CancellationToken
) {
	LOGGER.info('Test run started');
	const run = testingTools.controller.createTestRun(request);
	const queue: vscode.TestItem[] = [];
	const explicitInclude = Boolean(request.include?.length);
	const explicitExclude = Boolean(request.exclude?.length);
	const runAllTests = !explicitInclude && !explicitExclude;

	// If an individual test (case) is excluded, we approach its parent test (file) as a collection
	// of tests (cases), instead of as a single test (file).
	const toBreakUp: vscode.TestItem[] = [];
	if (explicitExclude) {
		request.exclude!.forEach((test) => {
			if (test.parent !== undefined) {
				toBreakUp.push(test.parent!);
			}
		});
	}

	// The items to run: every file for a run-all, otherwise the requested (or broken-up) items.
	const toRun: vscode.TestItem[] = [];
	if (runAllTests) {
		testingTools.controller.items.forEach((file) => toRun.push(file));
	} else {
		const eligibleTests = explicitInclude ? request.include! : testingTools.controller.items;
		eligibleTests.forEach((test: vscode.TestItem) => {
			if (toBreakUp.includes(test)) {
				test.children.forEach((child) => toRun.push(child));
			} else {
				toRun.push(test);
			}
		});
	}

	// Parse files whose children aren't materialized yet, so their leaves exist to mark.
	const parses: Promise<void>[] = [];
	toRun.forEach((item) => {
		if (testingTools.testItemData.get(item) === ItemType.File && item.children.size === 0) {
			parses.push(parseTestsFromFile(testingTools, item));
		}
	});
	await Promise.all(parses);

	// Mark each leaf "queued" so a run that stops early shows no stale/fresh mix. For a partial
	// run, also queue the item for the loop below; a run-all is one invocation over the directory.
	toRun.forEach((item) => {
		if (request.exclude?.includes(item)) {
			return;
		}
		markLeafTestsQueued(testingTools, item, run);
		if (!runAllTests) {
			queue.push(item);
		}
	});

	while (!token.isCancellationRequested && (queue.length > 0 || runAllTests)) {
		let test: vscode.TestItem | undefined;
		if (queue.length > 0) {
			test = queue.pop()!;
		}

		const startDate = Date.now();
		try {
			if (runAllTests) {
				LOGGER.info('Running all tests');
			} else {
				LOGGER.info(`Running test with label "${test!.label}"`);
			}
			const stdout = await runThatTest(testingTools, run, test);
			LOGGER.info(`Test output:\n${stdout}`);
		} catch (error) {
			LOGGER.error(`Run errored with reason: "${error}"`);
			if (test) {
				run.errored(test, new vscode.TestMessage(String(error)), Date.now() - startDate);
			}
		}

		if (runAllTests) {
			break;
		}
	}

	run.end();
}
