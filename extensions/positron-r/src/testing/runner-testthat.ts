/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import * as split2 from 'split2';
import { Logger } from '../extension';
import { lastRuntimePath } from '../runtime';
import { EXTENSION_ROOT_DIR } from '../constants';
import { ItemType, TestingTools, encodeNodeId } from './util-testing';
import { TestResult } from './reporter';
import { parseTestsFromFile } from './parser';

const testReporterPath = path
	.join(EXTENSION_ROOT_DIR, 'resources', 'testing', 'vscodereporter')
	.replace(/\\/g, '/');

export async function runThatTest(
	testingTools: TestingTools,
	run: vscode.TestRun,
	test?: vscode.TestItem
): Promise<string> {
	const getType = (testItem?: vscode.TestItem) => {
		if (testItem) {
			return testingTools.testItemData.get(testItem)!;
		} else {
			return ItemType.Directory;
		}
	};
	const testType = getType(test);

	switch (testType) {
		case ItemType.TestThat:
			Logger.info('Single test_that() test');
			break;
		case ItemType.Describe:
			Logger.info('Single describe() test: can\'t be run individually (yet)');
			// TODO: testthat doesn't support running a single describe() yet
			// TODO: figure out how to handle nested describe()
			return Promise.resolve('Single describe() test: can\'t be run individually (yet)');
		case ItemType.It:
			Logger.info('Individual it() call: can\'t be run individually');
			return Promise.resolve('Individual it() call: can\'t be run individually');
		case ItemType.File:
			Logger.info('Test type is file');
			if (test!.children.size === 0) {
				Logger.info('Children are not yet available. Parsing children.');
				await parseTestsFromFile(testingTools, test!);
			}
			break;
		case ItemType.Directory:
			Logger.info('Test type is directory');
			testingTools.controller.items.forEach(async (test) => {
				await parseTestsFromFile(testingTools, test);
			});
			break;
	}

	const isSingleTest = testType === ItemType.TestThat;
	const testPath = testType === ItemType.Directory ? testingTools.packageRoot.fsPath : test!.uri!.fsPath;

	Logger.info(
		`Started running ${isSingleTest ? 'single test' : 'all tests'
		} in ${testType === ItemType.Directory ? 'directory' : 'file'
		} '${testPath}'`
	);

	const rBinPath = await getRBinPath(testingTools);

	const { major, minor, patch } = await getDevtoolsVersion(rBinPath);
	if (major < 2 || (major === 2 && minor < 3) || (major === 2 && minor === 3 && patch < 2)) {
		return Promise.reject(
			Error(
				'Devtools version too old. RTestAdapter requires devtools>=2.3.2' +
				'to be installed in the Rscript environment'
			)
		);
	}

	const devtoolsMethod = testType === ItemType.Directory
		? 'test'
		: major === 2 && minor < 4 ? 'test_file' : 'test_active_file';

	const descInsert = isSingleTest ? ` desc = '${test?.label || '<all tests>'}', ` : '';
	const devtoolsCall =
		`devtools::load_all('${testReporterPath}');` +
		`devtools::${devtoolsMethod}('${testPath}',` +
		`${descInsert}reporter = VSCodeReporter)`;
	const command = `${rBinPath} --no-echo -e "${devtoolsCall}"`;
	Logger.info(`devtools call is:\n${command}`);

	const wd = testingTools.packageRoot.fsPath;
	Logger.info(`Running devtools call in working directory ${wd}`);
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
				Logger.debug(`Received test data: ${JSON.stringify(data)}`);
				switch (data.type) {
					case 'start_file':
						if (data.filename !== undefined) {
							Logger.info(`Setting hostFile to ${data.filename}`);
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
								Logger.error(
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
								Logger.error(
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
	Logger.debug(`Looking for test with id ${testIdToFind}`);
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

async function getRBinPath(testingTools: TestingTools) {
	// TODO: check behaviour against lastRuntimePath being the empty string
	if (!lastRuntimePath) {
		throw new Error(`No running R runtime to use for package testing.`);
	}
	const rBinPath = `${lastRuntimePath}/bin/R`;
	Logger.info(`Using R binary: ${rBinPath}`);
	return Promise.resolve(rBinPath);
}

async function getDevtoolsVersion(rBinPath: string): Promise<{ major: number; minor: number; patch: number }> {
	// TODO: abstract and refactor into a general minimum version checker, ie make package an argument
	// TODO @jennybc: if this code stays, figure this out
	// eslint-disable-next-line no-async-promise-executor
	return new Promise(async (resolve, reject) => {
		const childProcess = spawn(
			`${rBinPath} --no-echo -e "writeLines(format(packageVersion('devtools')))"`,
			{
				shell: true,
			}
		);
		let stdout = '';
		childProcess.once('exit', () => {
			stdout += childProcess.stdout.read() + '\n' + childProcess.stderr.read();
			const version = stdout.match(/(\d*)\.(\d*)\.(\d*)/i);
			if (version !== null) {
				Logger.info(`devtools version: ${version[0]}`);
				const major = parseInt(version[1]);
				const minor = parseInt(version[2]);
				const patch = parseInt(version[3]);
				resolve({ major, minor, patch });
			} else {
				reject(Error('devtools version could not be detected. Output:\n' + stdout));
			}
		});
		childProcess.once('error', (err) => {
			reject(err);
		});
	});
}
