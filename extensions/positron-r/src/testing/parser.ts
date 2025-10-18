/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as Parser from 'web-tree-sitter';
import { ItemType, TestingTools, encodeNodeId } from './util-testing';
import { LOGGER } from '../extension';
import { EXTENSION_ROOT_DIR } from '../constants';

const wasmPath = path.join(EXTENSION_ROOT_DIR, 'resources', 'testing', 'tree-sitter-r.wasm');
let parser: Parser | undefined;
let R: Parser.Language | undefined;
let _queryStrings: string[] | null = null;

// lazily initialize the parser
export async function initializeParser(): Promise<Parser> {
	LOGGER.info(`Initializing parser`);
	await (Parser as any).init();
	const parser = new (Parser as any)();
	LOGGER.info(`tree-sitter-r.wasm path: ${wasmPath}`);
	R = await Parser.Language.load(wasmPath);
	parser.setLanguage(R);
	return parser;
}

// lazily initialize the query strings
// future extension point to insert user-configured test functions
function getQueryStrings() {
	if (!_queryStrings) {
		const dirPath = path.join(EXTENSION_ROOT_DIR, 'resources', 'testing');
		const queryFiles = fs.readdirSync(dirPath)
			.filter(file => path.extname(file) === '.scm')
			.map(file => path.join(dirPath, file));
		if (queryFiles.length === 0) {
			LOGGER.info('No test query files found. No test items will be discovered.');
		} else {
			LOGGER.info(`Reading test queries from these files:\n${JSON.stringify(queryFiles, null, 2)}`);
		}
		_queryStrings = queryFiles.map(file => fs.readFileSync(file, 'utf8'));
	}
	return _queryStrings;
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

async function findTests(uri: vscode.Uri): Promise<TestMatch[]> {
	if (parser === undefined) {
		parser = await initializeParser();
	}
	const queryStrings = getQueryStrings();

	try {
		const matches: TestMatch[] = [];
		for (const queryString of queryStrings) {
			const queryMatches = await getMatchesForQuery(queryString, parser!, uri);
			matches.push(...queryMatches);
		}

		return matches;
	} catch (reason) {
		throw reason;
	}
}

/**
 * Details about a query match, in a testthat test file.
 */
interface Match {
	/** The name of the function we looked for, e.g. 'test_that', 'describe' or 'it'. */
	functionName: string;

	/**
	 * The description associated with the function call, in the sense of
	 * `test_that(desc =)`, `describe(description =)`, and `it(description =)`.
	 */
	desc: string;

	/** Where the matched call starts in the test file. */
	startPos: vscode.Position;

	/** Where the matched call ends in the test file. */
	endPos: vscode.Position;

	/**
	 * Is this a top-level call in the testthat file? Only top-level tests can be run individually.
	 * This is really about making sure we can distinguish a top-level `describe()` (individually
	 * runnable) from a `describe()` that's nested inside another `describe()` call (only runnable
	 * as part of its enclosing `describe()` or test file).
	 */
	topLevel: boolean | null;
}

/**
 * Match data for (what will become) a single test item, e.g. a call to `test_that()`, `describe()`,
 * or `it()`.
 */
interface TestMatch {
	/** Data for the call itself. */
	match: Match;
	/** Data for the parent `describe()` call. Only applies to `describe()` and `it()` calls. */
	parentMatch?: Match;
}

async function getMatchesForQuery(
	queryString: string,
	parser: Parser,
	uri: vscode.Uri
): Promise<TestMatch[]> {
	const document = await vscode.workspace.openTextDocument(uri);
	const query = R!.query(queryString);
	const tree = parser!.parse(document.getText());

	const raw_matches = query.matches(tree.rootNode);
	const matches: TestMatch[] = [];

	for (const match of raw_matches) {
		if (match === undefined) {
			continue;
		}

		const testFunctionCapture = match.captures.find(capture => capture.name === 'function');
		const testDescCapture = match.captures.find(capture => capture.name === 'desc');
		const testCallCapture = match.captures.find(capture => capture.name === 'call');

		if (testFunctionCapture && testDescCapture && testCallCapture) {
			const tm: TestMatch = {
				match: processCapture(testFunctionCapture, testDescCapture, testCallCapture)
			};

			const testParentFunctionCapture = match.captures.find(
				capture => capture.name === 'parent_function'
			);
			const testParentDescCapture = match.captures.find(
				capture => capture.name === 'parent_desc'
			);
			const testParentCallCapture = match.captures.find(
				capture => capture.name === 'parent_call'
			);

			if (testParentFunctionCapture && testParentDescCapture && testParentCallCapture) {
				tm.parentMatch = processCapture(
					testParentFunctionCapture,
					testParentDescCapture,
					testParentCallCapture
				);
			}

			matches.push(tm);
		}
	}

	return matches;
}

const toVSCodePosition = (pos: Parser.Point) => new vscode.Position(pos.row, pos.column);

function processCapture(
	captureFunction: Parser.QueryCapture,
	captureDesc: Parser.QueryCapture,
	captureCall: Parser.QueryCapture
): Match {
	return {
		functionName: captureFunction.node.text,
		// we start at 1 and end at (length - 1) because we don't want the surrounding quotes
		desc: captureDesc.node.text.substring(1, captureDesc.node.text.length - 1),
		startPos: toVSCodePosition(captureCall.node.startPosition),
		endPos: toVSCodePosition(captureCall.node.endPosition),
		topLevel: captureCall.node.parent && captureCall.node.parent.type === 'program'
	};
}
