/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { LOGGER } from '../extension';

export enum ItemType {
	Directory = 'directory',
	File = 'file',
	TestThat = 'test_that',
	Describe = 'describe',
	It = 'it',
}

export interface TestingTools {
	packageRoot: vscode.Uri;
	packageName: string;
	controller: vscode.TestController;
	testItemData: WeakMap<vscode.TestItem, ItemType>;
}

export function encodeNodeId(
	testFile: string,
	testLabel: string | undefined = undefined,
	testSuperLabel: string | undefined = undefined
) {
	return testSuperLabel
		? `${testFile}&${testSuperLabel} / ${testLabel}`
		: testLabel
			? `${testFile}&${testLabel}`
			: testFile;
}

/**
 * Escape a test label for use as the `desc` argument when running a single test
 * via R. The label is embedded in an R single-quoted string literal, which is
 * itself inside a double-quoted shell `-e` argument, so embedded quotes and
 * backticks must be escaped. Raw newlines from a multi-line test description are
 * escaped to `\r` / `\n` (preserving the exact line ending, never collapsing
 * CRLF to LF) so the shell command stays on one line and R reconstructs the
 * identical string. A raw newline truncates the command on Windows (#10133).
 */
export function escapeLabelForRDesc(label: string): string {
	return label
		.replace(/(['"`])/g, '\\$1')
		.replace(/\r/g, '\\r')
		.replace(/\n/g, '\\n');
}

export interface TestParser {
	(testingTools: TestingTools, file: vscode.TestItem): Promise<void>;
}

export interface TestRunner {
	(testingTools: TestingTools, run: vscode.TestRun, test: vscode.TestItem): Promise<string>;
}
