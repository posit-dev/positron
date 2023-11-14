/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { runThatTest } from './runner-testthat';
import { TestingTools, TestRunner } from './util-testing';
import { Logger } from '../extension';

function setRecursively(
	test: vscode.TestItem,
	callback: (test: vscode.TestItem) => any,
	excludeSet: readonly vscode.TestItem[] | undefined
) {
	if (!excludeSet?.includes(test)) {
		callback(test);
		test.children.forEach((childTest) => {
			setRecursively(childTest, callback, excludeSet);
		});
	}
}

export async function runHandler(
	testingTools: TestingTools,
	request: vscode.TestRunRequest,
	token: vscode.CancellationToken
) {
	Logger.info('Test run started.');
	const run = testingTools.controller.createTestRun(request);
	const queue: vscode.TestItem[] = [];

	// Loop through all included tests, or all known tests, and add them to our queue
	if (request.include) {
		request.include.forEach((test) => {
			queue.push(test);
			setRecursively(test, (test) => run.enqueued(test), request.exclude);
		});
	} else {
		testingTools.controller.items.forEach((test) => {
			queue.push(test);
			setRecursively(test, (test) => run.enqueued(test), request.exclude);
		});
	}
	Logger.info('Tests are enqueued.');

	// For every test that was queued, try to run it. Call run.passed() or run.failed().
	// The `TestMessage` can contain extra information, like a failing location or
	// a diff output. But here we'll just give it a textual message.
	while (queue.length > 0 && !token.isCancellationRequested) {
		const test = queue.pop()!;

		// Skip tests the user asked to exclude
		if (request.exclude?.includes(test)) {
			Logger.info(`Excluded test skipped: ${test.label}`);
			continue;
		}

		const startDate = Date.now();
		try {
			Logger.info(`Running test with label "${test.label}"`);
			test.busy = true;
			const stdout = await runThatTest(testingTools, run, test);
			test.busy = false;
			Logger.debug(`Test output:\n${stdout}`);
		} catch (error) {
			Logger.error(`Run errored with reason: "${error}"`);
			setRecursively(
				test,
				(test) => {
					if (test.busy) {
						run.errored(
							test,
							new vscode.TestMessage(String(error)),
							test.range === undefined ? Date.now() - startDate : undefined
						);
					}
				},
				request.exclude
			);
			test.busy = false;
		}
	}

	// Make sure to end the run after all tests have been executed:
	run.end();
}
