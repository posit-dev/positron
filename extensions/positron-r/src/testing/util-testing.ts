/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';

export enum ItemType {
	File = 'file',
	TestCase = 'test',
}

export interface TestingTools {
	controller: vscode.TestController;
	testItemData: WeakMap<vscode.TestItem, ItemType>;
}

export function encodeNodeId(
	filePath: string,
	testLabel: string,
	testSuperLabel: string | undefined = undefined
) {
	let normalizedFilePath = path.normalize(filePath);
	normalizedFilePath = normalizedFilePath.replace(/^[\\\/]+|[\\\/]+$/g, '');
	return testSuperLabel
		? `${normalizedFilePath}&${testSuperLabel}: ${testLabel}`
		: `${normalizedFilePath}&${testLabel}`;
}

export interface TestParser {
	(testingTools: TestingTools, file: vscode.TestItem): Promise<void>;
}

export interface TestRunner {
	(testingTools: TestingTools, run: vscode.TestRun, test: vscode.TestItem): Promise<string>;
}
