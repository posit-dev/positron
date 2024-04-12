/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as Parser from 'web-tree-sitter';
import { ItemType, TestingTools, encodeNodeId } from './util-testing';
import { LOGGER } from '../extension';
import { EXTENSION_ROOT_DIR } from '../constants';

const wasmPath = path.join(EXTENSION_ROOT_DIR, 'resources', 'testing', 'tree-sitter-r.wasm');
let parser: Parser | undefined;
let R: Parser.Language | undefined;

export async function initializeParser(): Promise<Parser> {
	LOGGER.info(`Initializing parser`);
	await Parser.init();
	const parser = new Parser();
	LOGGER.info(`tree-sitter-r.wasm path: ${wasmPath}`);
	R = await Parser.Language.load(wasmPath);
	parser.setLanguage(R);
	return parser;
}

export async function parseTestsFromFile(
	testingTools: TestingTools,
	file: vscode.TestItem
): Promise<void> {
	LOGGER.info(`Parsing test file ${file.uri}`);

	const uri = file.uri!;
	let matches;
	try {
		matches = await findTests(uri);
	} catch (error) {
		LOGGER.error(String(error));
		return;
	}

	const tests: Map<string, vscode.TestItem> = new Map();
	const testFile = path.basename(uri.fsPath);
	for (const match of matches) {
		if (match === undefined) {
			continue;
		}

		const testItem = testingTools.controller.createTestItem(
			encodeNodeId(testFile, match.testLabel, match.testSuperLabel),
			match.testLabel,
			uri
		);
		testItem.range = new vscode.Range(match.testStartPosition, match.testEndPosition);

		if (match.testSuperLabel === undefined) {
			testingTools.testItemData.set(testItem, ItemType.TestThat);
			tests.set(match.testLabel, testItem);
		} else {
			testingTools.testItemData.set(testItem, ItemType.It);
			if (tests.has(match.testSuperLabel)) {
				tests.get(match.testSuperLabel)!.children.add(testItem);
			} else {
				const supertestItem = testingTools.controller.createTestItem(
					encodeNodeId(testFile, match.testSuperLabel),
					match.testSuperLabel,
					uri
				);
				testingTools.testItemData.set(supertestItem, ItemType.Describe);
				supertestItem.range = new vscode.Range(
					match.testSuperStartPosition!,
					match.testSuperEndPosition!
				);
				supertestItem.children.add(testItem);
				tests.set(match.testSuperLabel, supertestItem);
			}
		}
	}

	file.children.replace([...tests.values()]);
	return;
}

async function findTests(uri: vscode.Uri) {
	if (parser === undefined) {
		parser = await initializeParser();
	}

	try {
		const document = await vscode.workspace.openTextDocument(uri);
		const tree = parser!.parse(document.getText());
		const matches = [];

		const toVSCodePosition = (pos: any) => new vscode.Position(pos.row, pos.column);

		let queryPath = path.join(EXTENSION_ROOT_DIR, 'resources', 'testing', 'test_that.scm');
		let queryContent = await vscode.workspace.fs.readFile(vscode.Uri.file(queryPath));
		let query = R!.query(queryContent.toString());
		let raw_matches = query.matches(tree.rootNode);

		for (const match of raw_matches) {
			if (match === undefined) {
				continue;
			}

			//const testFunctionCapture = match.captures.find(capture => capture.name === '_function.name');
			const testLabelCapture = match.captures.find(capture => capture.name === 'label');
			const testCallCapture = match.captures.find(capture => capture.name === 'call');

			if (testLabelCapture && testCallCapture) {
				matches.push({
					testLabel: testLabelCapture.node.text.substring(
						1,
						testLabelCapture.node.text.length - 1
					),
					testStartPosition: toVSCodePosition(testCallCapture.node.startPosition),
					testEndPosition: toVSCodePosition(testCallCapture.node.endPosition)
				});
			}
		}

		queryPath = path.join(EXTENSION_ROOT_DIR, 'resources', 'testing', 'describe.scm');
		queryContent = await vscode.workspace.fs.readFile(vscode.Uri.file(queryPath));
		query = R!.query(queryContent.toString());

		raw_matches = query.matches(tree.rootNode);

		for (const match of raw_matches) {
			if (match === undefined) {
				continue;
			}
			matches.push({
				testSuperLabel: match.captures[2].node.text.substring(
					1,
					match.captures[2].node.text.length - 1
				),
				testSuperStartPosition: toVSCodePosition(
					match.captures[0].node.startPosition
				),
				testSuperEndPosition: toVSCodePosition(match.captures[0].node.endPosition),
				testLabel: match.captures[5].node.text.substring(
					1,
					match.captures[5].node.text.length - 1
				),
				testStartPosition: toVSCodePosition(match.captures[3].node.startPosition),
				testEndPosition: toVSCodePosition(match.captures[3].node.endPosition),
			});
		}

		return matches;
	} catch (reason) {
		throw reason;
	}
}

// interface Match {
// 	text: string;
// 	startPos: vscode.Position;
// 	endPos: vscode.Position;
// }

// async function processQueries(queryPaths: string[], tree: any, R: any): Promise<Match[]> {
// 	const matches: Match[] = [];
// 	const toVSCodePosition = (pos: any) => new vscode.Position(pos.row, pos.column);

// 	for (const queryPath of queryPaths) {
// 		const fullPath = path.join(EXTENSION_ROOT_DIR, 'resources', 'testing', queryPath);
// 		const queryContent = await vscode.workspace.fs.readFile(vscode.Uri.file(fullPath));
// 		const query = R!.query(queryContent.toString());

// 		const raw_matches = query.matches(tree.rootNode);

// 		for (const match of raw_matches) {
// 			if (match === undefined) {
// 				continue;
// 			}
// 			matches.push({
// 				testLabel: match.captures[2].node.text.substring(
// 					1,
// 					match.captures[2].node.text.length - 1
// 				),
// 				testStartPosition: toVSCodePosition(match.captures[0].node.startPosition),
// 				testEndPosition: toVSCodePosition(match.captures[0].node.endPosition),
// 			});
// 		}
// 	}

// 	return matches;
// }
