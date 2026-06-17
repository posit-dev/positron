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
 * via R. The label is embedded in an R single-quoted string literal, itself inside
 * a double-quoted shell `-e` argument, so embedded quotes and backticks must be
 * escaped. The `\n` inside a multi-line description must also be escaped for
 * proper handling on Windows (#10133).
 */
export function escapeLabelForRDesc(label: string): string {
	return label
		.replace(/(['"`])/g, '\\$1')
		.replace(/\n/g, '\\n');
}

export interface TestParser {
	(testingTools: TestingTools, file: vscode.TestItem): Promise<void>;
}

export interface TestRunner {
	(testingTools: TestingTools, run: vscode.TestRun, test: vscode.TestItem): Promise<string>;
}
