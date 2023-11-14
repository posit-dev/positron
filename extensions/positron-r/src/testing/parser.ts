/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { ItemType, TestingTools, encodeNodeId } from './util-testing';
import { Logger } from '../extension';

const wasmPath = path.join(__dirname, 'tree-sitter-r.wasm');
const Parser = require('web-tree-sitter');
let R: any;

async function prepareParser(): Promise<any> {
	await Parser.init();
	const parser = new Parser();
	R = await Parser.Language.load(wasmPath);
	parser.setLanguage(R);
	return parser;
}

const parser = prepareParser();

export async function parseTestsFromFile(
	testingTools: TestingTools,
	file: vscode.TestItem
): Promise<void> {
	Logger.info(`Parsing test file ${file.uri}`);

	const uri = file.uri!;
	let matches;
	try {
		matches = await findTests(uri);
	} catch (error) {
		Logger.error(String(error));
		return;
	}

	const tests: Map<string, vscode.TestItem> = new Map();
	for (const match of matches) {
		if (match === undefined) {
			continue;
		}

		const testItem = testingTools.controller.createTestItem(
			encodeNodeId(uri.fsPath, match.testLabel, match.testSuperLabel),
			match.testLabel,
			uri
		);
		testItem.range = new vscode.Range(match.testStartPosition, match.testEndPosition);
		testingTools.testItemData.set(testItem, ItemType.TestCase);

		if (match.testSuperLabel === undefined) {
			tests.set(match.testLabel, testItem);
		} else {
			if (tests.has(match.testSuperLabel)) {
				tests.get(match.testSuperLabel)!.children.add(testItem);
			} else {
				const supertestItem = testingTools.controller.createTestItem(
					encodeNodeId(uri.fsPath, match.testSuperLabel),
					match.testSuperLabel,
					uri
				);
				testingTools.testItemData.set(supertestItem, ItemType.TestCase);
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
	const parserResolved = await parser;
	return vscode.workspace.openTextDocument(uri).then(
		(document: vscode.TextDocument) => {
			const tree = parserResolved.parse(document.getText());
			const query = R.query(
				`
				(call
					function: [
						(identifier) @_function.name
						(namespace_get
							function: (identifier) @_function.name
						)
					] (#eq? @_function.name "test_that")
					arguments:
						(arguments
							value: (string) @label
							value: (_)
						)
				) @call

				(call
					function: [
						(identifier) @_superfunction.name
						(namespace_get
							function: (identifier) @_superfunction.name
						)
					] (#eq? @_superfunction.name "describe")
					arguments:
						(arguments
							value: (string) @superlabel
							value: (_
								(call
									function: [
										(identifier) @_function.name
										(namespace_get
											function: (identifier) @_function.name
										)
									] (#eq? @_function.name "it")
									arguments:
										(arguments
											value: (string) @label
											value: (_)
										)
								) @call
							)
						)
				) @supercall
				`
			);
			const raw_matches = query.matches(tree.rootNode);
			const toVSCodePosition = (pos: any) => new vscode.Position(pos.row, pos.column);

			const matches = [];

			for (const match of raw_matches) {
				if (match === undefined) {
					continue;
				}
				if (match.pattern === 0) {
					matches.push({
						testLabel: match.captures[2].node.text.substring(
							1,
							match.captures[2].node.text.length - 1
						),
						testStartPosition: toVSCodePosition(match.captures[0].node.startPosition),
						testEndPosition: toVSCodePosition(match.captures[0].node.endPosition),
					});
				} else {
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
			}

			return matches;
		},
		(reason: any) => {
			throw reason;
		}
	);
}
