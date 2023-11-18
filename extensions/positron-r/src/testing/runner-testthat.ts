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
	test: vscode.TestItem
): Promise<string> {
	const getType = (testItem: vscode.TestItem) => testingTools.testItemData.get(testItem)!;
	const testType = getType(test);
	const isSingleTest = testType === ItemType.TestCase;

	if (isSingleTest) {
		if (test.children.size === 0) {
			Logger.info('Test type is test case and a single test');
		} else {
			Logger.info('Test type is test case and a describe suite');
		}
	} else {
		Logger.info('Test type is file');
		if (test.children.size === 0) {
			Logger.info('Children are not yet available. Parsing children.');
			await parseTestsFromFile(testingTools, test);
		}
	}

	const filePath = test.uri!.fsPath;
	const cleanFilePath = filePath.replace(/\\/g, '/');

	Logger.info(
		`Started running${isSingleTest ? ' single test' : ' all tests'} in file ${filePath}`
	);

	const projectDirMatch = cleanFilePath.match(/(.+?)\/tests\/testthat.+?/i);

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
	const devtoolsMethod = major === 2 && minor < 4 ? 'test_file' : 'test_active_file';
	const descInsert = isSingleTest ? ` desc = '${test.label}', ` : '';
	const devtoolsCall =
		`devtools::load_all('${testReporterPath}');` +
		`devtools::${devtoolsMethod}('${cleanFilePath}',` +
		`${descInsert}reporter = VSCodeReporter)`;
	const command = `${rBinPath} --no-echo -e "${devtoolsCall}"`;
	Logger.info(`devtools call is:\n${command}`);

	const cwd = projectDirMatch
		? projectDirMatch[1]
		: vscode.workspace.workspaceFolders![0].uri.fsPath;
	Logger.info(`Running devtools call in working directory ${cwd}`);
	// TODO @jennybc: if this code stays, figure this out
	// eslint-disable-next-line no-async-promise-executor
	return new Promise<string>(async (resolve, reject) => {
		const childProcess = spawn(command, { cwd, shell: true });
		let stdout = '';
		const testStartDates = new WeakMap<vscode.TestItem, number>();
		childProcess.stdout!.pipe(split2(JSON.parse)).on('data', (data: TestResult) => {
			stdout += JSON.stringify(data);
			Logger.info(`Received test data: ${JSON.stringify(data)}`);
			switch (data.type) {
				case 'start_test':
					if (data.test !== undefined) {
						const testItem = isSingleTest
							? test
							: findTestRecursively(encodeNodeId(test.uri!.fsPath, data.test), test);
						if (testItem === undefined) {
							reject(
								`Test with id ${encodeNodeId(
									test.uri!.fsPath,
									data.test
								)} could not be found. Please report this.`
							);
						}
						testStartDates.set(testItem!, Date.now());
						run.started(testItem!);
					}
					break;
				case 'add_result':
					if (data.result !== undefined && data.test !== undefined) {
						const testItem = isSingleTest
							? test
							: findTestRecursively(encodeNodeId(test.uri!.fsPath, data.test), test);
						if (testItem === undefined) {
							reject(
								`Test with id ${encodeNodeId(
									test.uri!.fsPath,
									data.test
								)} could not be found. Please report this.`
							);
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

function findTestRecursively(testIdToFind: string, testToSearch: vscode.TestItem) {
	let testFound: vscode.TestItem | undefined = undefined;
	testToSearch.children.forEach((childTest: vscode.TestItem) => {
		if (testFound === undefined) {
			testFound =
				testIdToFind === childTest.id
					? childTest
					: findTestRecursively(testIdToFind, childTest);
		}
	});
	return testFound;
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
