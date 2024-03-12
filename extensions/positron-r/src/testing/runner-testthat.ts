/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import * as split2 from 'split2';
import { LOGGER } from '../extension';
import { checkInstalled } from '../session';
import { EXTENSION_ROOT_DIR } from '../constants';
import { ItemType, TestingTools, encodeNodeId } from './util-testing';
import { TestResult } from './reporter';
import { parseTestsFromFile } from './parser';
import { RSessionManager } from '../session-manager';

const testReporterPath = path
	.join(EXTENSION_ROOT_DIR, 'resources', 'testing', 'vscodereporter')
	.replace(/\\/g, '/');

export async function runThatTest(
	testingTools: TestingTools,
	run: vscode.TestRun,
	test?: vscode.TestItem
): Promise<string> {
	// in all scenarios, we execute devtools::SOMETHING() in a child process
	// if we can't get the path to the relevant R executable, no point in continuing
	if (!RSessionManager.instance.hasLastBinpath()) {
		return Promise.resolve('No running R runtime to run R package tests.');
	}

	// devtools 2.4.0 was released 2021-04-07
	// chosen as minimum version because that's when test_active_file() was introduced
	// indirectly imposes requirement for testthat >= 3.0.2
	const devtoolsInstalled = await checkInstalled('devtools', '2.4.0');
	if (!devtoolsInstalled) {
		return Promise.resolve('devtools >= 2.4.0 is needed to run R package tests.');
	}

	const getType = (testItem?: vscode.TestItem) => {
		if (testItem) {
			return testingTools.testItemData.get(testItem)!;
		} else {
			return ItemType.Directory;
		}
	};
	const testType = getType(test);

	switch (testType) {
		case ItemType.TestThat: {
			const testthatInstalled = await checkInstalled('testthat', '3.2.0');
			if (!testthatInstalled) {
				return Promise.resolve('testthat >= 3.2.0 is needed to run R a single test_that() test.');
			}
			LOGGER.info('Single test_that() test');
			break;
		}
		// TODO: testthat >= 3.2.1 introduces support for running a single top-level describe().
		case ItemType.Describe:
			return Promise.resolve('Single describe() test: can\'t be run individually (yet).');
		case ItemType.It:
			return Promise.resolve('Individual it() call: can\'t be run individually.');
		case ItemType.File:
			LOGGER.info('Test type is file');
			if (test!.children.size === 0) {
				LOGGER.info('Children are not yet available. Parsing children.');
				await parseTestsFromFile(testingTools, test!);
			}
			break;
		case ItemType.Directory:
			LOGGER.info('Test type is directory');
			testingTools.controller.items.forEach(async (test) => {
				await parseTestsFromFile(testingTools, test);
			});
			break;
	}

	const isSingleTest = testType === ItemType.TestThat;
	let testPath = testType === ItemType.Directory ? testingTools.packageRoot.fsPath : test!.uri!.fsPath;
	LOGGER.info(
		`Started running ${isSingleTest ? 'single test' : 'all tests'
		} in ${testType === ItemType.Directory ? 'directory' : 'file'
		} '${testPath}'`
	);
	// use POSIX path separators in the test-running R snippet for better portability
	testPath = testPath.replace(/\\/g, '/');

	const devtoolsMethod = testType === ItemType.Directory ? 'test' : 'test_active_file';
	const descInsert = isSingleTest ? ` desc = '${test?.label || '<all tests>'}', ` : '';
	const devtoolsCall =
		`devtools::load_all('${testReporterPath}');` +
		`devtools::${devtoolsMethod}('${testPath}',` +
		`${descInsert}reporter = VSCodeReporter)`;
	const binpath = RSessionManager.instance.getLastBinpath();
	const command = `"${binpath}" --no-echo -e "${devtoolsCall}"`;
	LOGGER.info(`devtools call is:\n${command}`);

	const wd = testingTools.packageRoot.fsPath;
	LOGGER.info(`Running devtools call in working directory ${wd}`);
	let hostFile = '';
	// TODO @jennybc: if this code stays, figure this out
	// eslint-disable-next-line no-async-promise-executor
	return new Promise<string>(async (resolve, reject) => {
		// FIXME (@jennybc): once I can ask the current runtime for its LC_CTYPE (and possibly
		// other locale categories or even LANG), use something like this to make the child
		// process better match the runtime. Learned this from reprex's UTF-8 test which currently
		// fails in the test explorer because the reprex is being rendered in the C locale.
		// Also affects the tests for glue.
		// const childProcess = spawn(command, {
		// 	cwd: wd,
		// 	shell: true,
		// 	env: {
		// 		...process.env,
		// 		LC_CTYPE: 'en_US.UTF-8'
		// 	}
		// });
		const childProcess = spawn(command, { cwd: wd, shell: true });
		let stdout = '';
		const testStartDates = new WeakMap<vscode.TestItem, number>();
		childProcess.stdout!
			.pipe(split2((line: string) => {
				try {
					return JSON.parse(line);
				} catch { }
			}))
			.on('data', (data: TestResult) => {
				stdout += JSON.stringify(data);
				LOGGER.debug(`Received test data: ${JSON.stringify(data)}`);
				switch (data.type) {
					case 'start_file':
						if (data.filename !== undefined) {
							LOGGER.info(`Setting hostFile to ${data.filename}`);
							hostFile = data.filename;
						}
						break;
					case 'start_test':
						if (data.test !== undefined) {
							const testItem = isSingleTest
								? test
								: findTest(hostFile, data.test, testingTools);
							if (testItem === undefined) {
								// Something is clearly wrong with this test vis-a-vis the test
								// explorer, but I suspect we should just soldier on.
								// Changed from reject() in response to dplyr having a test like so:
								// test_that(paste0("blah blah"), {})
								// which would bring the whole test run to a halt.
								// In that case, the test was never registered, because it doesn't
								// match the tree-sitter query. Long-term, I plan to modify the
								// query (make it more permissive), then make a headless
								// `match.call()` test to resolve `desc`.
								LOGGER.error(
									`Test with id ${encodeNodeId(
										hostFile,
										data.test
									)} could not be found. Please report this.`
								);
								return;
							}
							testStartDates.set(testItem!, Date.now());
							run.started(testItem!);
						}
						break;
					case 'add_result':
						if (data.result !== undefined && data.test !== undefined) {
							const testItem = isSingleTest
								? test
								: findTest(hostFile, data.test, testingTools);
							if (testItem === undefined) {
								// See above.
								LOGGER.error(
									`Test with id ${encodeNodeId(
										hostFile,
										data.test
									)} could not be found. Please report this.`
								);
								return;
							}
							const duration = Date.now() - testStartDates.get(testItem!)!;
							switch (data.result) {
								case 'success':
								case 'warning':
									run.passed(testItem!, duration);
									if (data.message) {
										run.appendOutput(data.message, undefined, testItem);
									}
									break;
								case 'failure':
									run.failed(
										testItem!,
										new vscode.TestMessage(data.message!),
										duration
									);
									break;
								case 'skip':
									run.skipped(testItem!);
									if (data.message) {
										run.appendOutput(data.message, undefined, testItem);
									}
									break;
								case 'error':
									run.errored(
										testItem!,
										new vscode.TestMessage(data.message!),
										duration
									);
									break;
							}
						}
						break;
				}
			});
		childProcess.once('exit', () => {
			stdout += childProcess.stderr.read();
			if (stdout.includes('Execution halted')) {
				reject(Error(stdout));
			}
			resolve(stdout);
		});
		childProcess.once('error', (err) => {
			reject(err);
		});
	});
}

// Current plan is to only support running top-level test_that() or describe() calls via mouse
// click, as that's what is (test_that() case) or, I assume, will be (describe() case) supported
// by testthat itself.
// However, when we parse test files, smaller units are still parsed out of describe() calls
// (e.g. the it() calls) and results are reported for these units. Even though the it() calls aren't
// runnable individually, we still need to have a concept of them for reporting.
//
// I guess the best description of what happens for nested describe() calls at this point is
// "undefined behaviour".
function findTest(
	testFile: string,
	testLabel: string,
	testingTools: TestingTools): vscode.TestItem | undefined {
	const testIdToFind = encodeNodeId(testFile, testLabel);
	LOGGER.debug(`Looking for test with id ${testIdToFind}`);
	const testFileToSearch = testingTools.controller.items.get(testFile);
	const firstGenerationFound = testFileToSearch?.children.get(testIdToFind);
	if (firstGenerationFound) {
		return firstGenerationFound;
	}
	// if file contains any describe() calls, search the it()s within those too
	let secondGenerationFound: vscode.TestItem | undefined;
	testFileToSearch?.children.forEach((item) => {
		const found = item.children?.get(testIdToFind);
		if (found) {
			secondGenerationFound = found;
		}
	});
	return secondGenerationFound;
}
