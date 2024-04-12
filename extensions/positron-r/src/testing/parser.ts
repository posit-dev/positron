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
			encodeNodeId(testFile, match.match.desc, match.parentMatch?.desc),
			match.match.desc,
			uri
		);
		testItem.range = new vscode.Range(match.match.startPos, match.match.endPos);

		if (match.parentMatch === undefined) {
			testingTools.testItemData.set(testItem, ItemType.TestThat);
			tests.set(match.match.desc, testItem);
		} else {
			testingTools.testItemData.set(testItem, ItemType.It);
			if (tests.has(match.parentMatch.desc)) {
				tests.get(match.parentMatch.desc)!.children.add(testItem);
			} else {
				const supertestItem = testingTools.controller.createTestItem(
					encodeNodeId(testFile, match.parentMatch.desc),
					match.parentMatch.desc,
					uri
				);
				testingTools.testItemData.set(supertestItem, ItemType.Describe);
				supertestItem.range = new vscode.Range(
					match.parentMatch.startPos!,
					match.parentMatch.endPos!
				);
				supertestItem.children.add(testItem);
				tests.set(match.parentMatch.desc, supertestItem);
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

		let queryPath = path.join(EXTENSION_ROOT_DIR, 'resources', 'testing', 'test_that.scm');
		let queryContent = await vscode.workspace.fs.readFile(vscode.Uri.file(queryPath));
		let query = R!.query(queryContent.toString());

		const matches = createMatchObjects(query, tree);

		queryPath = path.join(EXTENSION_ROOT_DIR, 'resources', 'testing', 'describe.scm');
		queryContent = await vscode.workspace.fs.readFile(vscode.Uri.file(queryPath));
		query = R!.query(queryContent.toString());

		matches.push(...createMatchObjects(query, tree));

		return matches;
	} catch (reason) {
		throw reason;
	}
}

interface Match {
	functionName: string;
	desc: string;
	startPos: vscode.Position;
	endPos: vscode.Position;
}

interface TestMatch {
	match: Match;
	parentMatch?: Match;
}

function createMatchObjects(query: Parser.Query, tree: Parser.Tree): TestMatch[] {
	const raw_matches = query.matches(tree.rootNode);
	const matches: TestMatch[] = [];

	for (const match of raw_matches) {
		if (match === undefined) {
			continue;
		}

		const testFunctionCapture = match.captures.find(capture => capture.name === '_function.name');
		const testLabelCapture = match.captures.find(capture => capture.name === 'label');
		const testCallCapture = match.captures.find(capture => capture.name === 'call');

		if (testFunctionCapture && testLabelCapture && testCallCapture) {
			const matchObject: TestMatch = {
				match: processCapture(testFunctionCapture, testLabelCapture, testCallCapture)
			};

			const testSuperFunctionCapture = match.captures.find(capture => capture.name === '_superfunction.name');
			const testSuperLabelCapture = match.captures.find(capture => capture.name === 'superlabel');
			const testSuperCallCapture = match.captures.find(capture => capture.name === 'supercall');

			if (testSuperFunctionCapture && testSuperLabelCapture && testSuperCallCapture) {
				matchObject.parentMatch = processCapture(testSuperFunctionCapture, testSuperLabelCapture, testSuperCallCapture);
			}

			matches.push(matchObject);
		}
	}

	return matches;
}

const toVSCodePosition = (pos: any) => new vscode.Position(pos.row, pos.column);

function processCapture(
	captureFunction: Parser.QueryCapture,
	captureLabel: Parser.QueryCapture,
	captureCall: Parser.QueryCapture
): Match {
	return {
		functionName: captureFunction.node.text,
		desc: captureLabel.node.text.substring(
			1,
			captureLabel.node.text.length - 1
		),
		startPos: toVSCodePosition(captureCall.node.startPosition),
		endPos: toVSCodePosition(captureCall.node.endPosition)
	};
}
