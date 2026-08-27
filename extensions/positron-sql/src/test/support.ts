/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { SqlAnalyzer } from '../analyzer';

/** The analyzer, compiled once and shared: it is stateless, and compiling it is the slow part. */
let analyzer: SqlAnalyzer | undefined;

export function testAnalyzer(): SqlAnalyzer {
	const extension = vscode.extensions.getExtension('positron.positron-sql');
	if (!extension) {
		throw new Error('The positron-sql extension is not installed in this test host.');
	}
	analyzer ??= SqlAnalyzer.load(
		path.join(extension.extensionPath, 'resources', 'sql-analyzer.wasm'),
		message => { throw new Error(message); },
	);
	return analyzer;
}

/** A SQL document with the given contents, for a provider to be run against. */
export function sqlDocument(content: string): Thenable<vscode.TextDocument> {
	return vscode.workspace.openTextDocument({ language: 'sql', content });
}
