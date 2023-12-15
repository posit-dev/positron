/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Logger } from '../extension';

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
		? `${testFile}&${testSuperLabel}: ${testLabel}`
		: testLabel
			? `${testFile}&${testLabel}`
			: testFile;
}

export interface TestParser {
	(testingTools: TestingTools, file: vscode.TestItem): Promise<void>;
}

export interface TestRunner {
	(testingTools: TestingTools, run: vscode.TestRun, test: vscode.TestItem): Promise<string>;
}
