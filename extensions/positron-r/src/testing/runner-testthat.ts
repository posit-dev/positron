/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import split2 from 'split2';
import { LOGGER } from '../extension';
import { checkInstalled, getLocale } from '../session';
import { EXTENSION_ROOT_DIR } from '../constants';
import { ItemType, TestingTools, encodeNodeId, escapeLabelForRDesc } from './util-testing';
import { TestResult } from './reporter';
import { RSessionManager } from '../session-manager';

const testReporterPath = path
	.join(EXTENSION_ROOT_DIR, 'resources', 'testing', 'vscodereporter')
	.replace(/\\/g, '/');

// Test-run R processes currently in flight. The OS won't reap them if the extension
// host goes away mid-run, so we track them and hard-kill any survivors when the test
// explorer is disposed (see killActiveTestRuns).
const activeRunProcesses = new Set<ChildProcess>();

// Signal the R test-run process by PID. POSIX SIGINT lets R unwind gracefully;
// SIGKILL forces it. Windows has no per-process signal, so taskkill force-terminates;
// /T also kills the child R process (the R.exe front-end spawns the actual R).
function signalRunProcess(childProcess: ChildProcess, signal: NodeJS.Signals): void {
	const pid = childProcess.pid;
	if (pid === undefined) {
		return;
	}
	try {
		if (process.platform === 'win32') {
			const result = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { encoding: 'utf8' });
			LOGGER.info(`taskkill /T /F pid=${pid}: status=${result.status}, stdout=${result.stdout?.trim()}, stderr=${result.stderr?.trim()}`);
		} else {
			process.kill(pid, signal);
		}
	} catch (err) {
		LOGGER.warn(`Failed to send ${signal} to the R test run: ${err}`);
	}
}

/**
 * Hard-kill any in-flight test-run processes. Called when the test explorer is torn
 * down so a run interrupted by a window close or reload can't leak the R process.
 * There's no time for graceful cleanup on this path, so we SIGKILL.
 */
export function killActiveTestRuns(): void {
	for (const childProcess of activeRunProcesses) {
		signalRunProcess(childProcess, 'SIGKILL');
	}
	activeRunProcesses.clear();
}

export async function runThatTest(
	testingTools: TestingTools,
	run: vscode.TestRun,
	token: vscode.CancellationToken,
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
		// TODO: Should really also require that this is a top-level describe().
		case ItemType.Describe: {
			const testthatInstalled = await checkInstalled('testthat', '3.2.1');
			if (!testthatInstalled) {
				return Promise.resolve('testthat >= 3.2.1 is needed to run a single describe() test.');
			}
			LOGGER.info('Single describe() test');
			break;
		}
		case ItemType.It:
			return Promise.resolve('Individual it() call: can\'t be run individually.');
		case ItemType.File:
			LOGGER.info('Test type is file');
			break;
		case ItemType.Directory:
			LOGGER.info('Test type is directory');
			break;
	}

	const isSingleTest = testType === ItemType.TestThat || testType === ItemType.Describe;
	let testPath = testType === ItemType.Directory ? testingTools.packageRoot.fsPath : test!.uri!.fsPath;
	LOGGER.info(
		`Started running ${isSingleTest ? 'single test' : 'all tests'
		} in ${testType === ItemType.Directory ? 'directory' : 'file'
		} '${testPath}'`
	);
	// use POSIX path separators in the test-running R snippet for better portability
	testPath = testPath.replace(/\\/g, '/');

	const devtoolsMethod = testType === ItemType.Directory ? 'test' : 'test_active_file';
	const escapedLabel = test?.label === undefined ? undefined : escapeLabelForRDesc(test.label);
	const descInsert = isSingleTest ? ` desc = '${escapedLabel || '<all tests>'}', ` : '';
	const devtoolsCall =
		`devtools::load_all('${testReporterPath}');` +
		`devtools::${devtoolsMethod}('${testPath}',` +
		`${descInsert}reporter = VSCodeReporter)`;
	const binpath = RSessionManager.instance.getLastBinpath();
	const args = ['--no-echo', '-e', devtoolsCall];
	LOGGER.info(`R binary is: ${binpath}`);
	LOGGER.info(`devtools call is:\n${devtoolsCall}`);

	const wd = testingTools.packageRoot.fsPath;
	LOGGER.info(`Running devtools call in working directory ${wd}`);
	const locale = await getLocale();
	LOGGER.info(`Locale info from active R session: ${JSON.stringify(locale, null, 2)}`);
	let hostFile = '';
	return new Promise<string>((resolve, reject) => {
		const childProcess = spawn(binpath, args, {
			cwd: wd,
			env: {
				...process.env,
				LANG: locale['LANG']
			}
		});
		activeRunProcesses.add(childProcess);

		let cancelled = false;
		let forceQuitTimer: NodeJS.Timeout | undefined;
		const cancellation = token.onCancellationRequested(() => {
			cancelled = true;
			LOGGER.info('Test run cancelled; interrupting R so cleanup can run');
			// Append now, not on exit: core can finalize a cancelled run before R
			// exits, so a note appended on exit may be dropped.
			run.appendOutput('\r\nThe test run was stopped at the user\'s request.\r\n');
			// SIGINT lets R unwind and run on.exit / withr / teardown cleanup before
			// exiting; SIGTERM and SIGKILL would skip all of that. So we hope
			// that SIGINT works.
			signalRunProcess(childProcess, 'SIGINT');
			// If R hasn't stopped after a grace period (e.g. a non-interruptible
			// C loop), we offer to force quit. We use 7s because it's less than the
			// 10s after which the core test explorer makes the run look cancelled in
			// the UI even though it hasn't really stopped -- so we prompt before that.
			forceQuitTimer = setTimeout(() => {
				if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
					return;
				}
				vscode.window.showWarningMessage(
					vscode.l10n.t('R is not responding to the interrupt signal. You can force quit, but this may skip test cleanup and teardown.'),
					vscode.l10n.t('Force Quit')
				).then((choice) => {
					if (choice !== undefined &&
						childProcess.exitCode === null && childProcess.signalCode === null) {
						LOGGER.info('User chose to force quit the R test run');
						signalRunProcess(childProcess, 'SIGKILL');
					}
				});
			}, 7_000);
		});
		const cleanup = () => {
			cancellation.dispose();
			if (forceQuitTimer !== undefined) {
				clearTimeout(forceQuitTimer);
			}
			activeRunProcesses.delete(childProcess);
		};

		let stdout = '';
		let sawEndReporter = false;
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
							const testItem = testType === ItemType.TestThat
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
										// Currently skip messages leak out to the TEST RESULTS
										// area, which is presumably not the long-term plan for
										// how we want to use that space.
										// But in the meantime, let's at least break lines.
										// appendOutput method is documented to need CRLF not LF.
										run.appendOutput(
											data.message + ': ' + data.location + '\r\n',
											undefined,
											testItem
										);
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
					case 'end_reporter':
						sawEndReporter = true;
						break;
				}
			});
		childProcess.once('exit', (code, signal) => {
			cleanup();
			const stderr = String(childProcess.stderr.read() ?? '');
			stdout += stderr;
			if (sawEndReporter) {
				resolve(stdout);
				return;
			}
			if (cancelled) {
				// The user stopped the run; the note was appended at cancellation time.
				resolve(stdout);
				return;
			}
			// If we haven't seen end_reporter, that means R died before testthat
			// finished its work cleanly (e.g. a failed load_all(), an error in a
			// setup or helper file, or an R crash). Surface what we know in TEST
			// RESULTS.
			const how = signal ? `signal ${signal}` : `exit code ${code}`;
			run.appendOutput(
				`\r\nThe R test run ended before completing (${how}).\r\n`
			);
			const detail = stderr.trim();
			if (detail) {
				run.appendOutput(detail.replace(/\r?\n/g, '\r\n') + '\r\n');
			}
			reject(new Error(detail || `R exited with ${how} before completing.`));
		});
		childProcess.once('error', (err) => {
			cleanup();
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
