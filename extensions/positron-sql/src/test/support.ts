/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { AnalyzerLimits, SqlAnalyzer } from '../analyzer';
import { SqlLog } from '../log';

/** The analyzer, compiled once and shared: it is stateless, and compiling it is the slow part. */
let analyzer: SqlAnalyzer | undefined;

/** Fails the test on anything the analyzer reports. */
export const STRICT_LOG: Pick<SqlLog, 'warn' | 'error'> = {
	warn: message => { throw new Error(message); },
	error: message => { throw new Error(String(message)); },
};

export function testAnalyzer(): SqlAnalyzer {
	analyzer ??= loadAnalyzer(STRICT_LOG);
	return analyzer;
}

/**
 * An analyzer of its own, for a test that changes its limits or listens to what it reports, and
 * so cannot share the one {@link testAnalyzer} returns.
 */
export function loadAnalyzer(log: Pick<SqlLog, 'warn' | 'error'>, limits?: AnalyzerLimits): SqlAnalyzer {
	const extension = vscode.extensions.getExtension('positron.positron-sql');
	if (!extension) {
		throw new Error('The positron-sql extension is not installed in this test host.');
	}
	return SqlAnalyzer.load(
		path.join(extension.extensionPath, 'resources', 'sql-analyzer.wasm'),
		log,
		limits,
	);
}

/** A SQL document with the given contents, for a provider to be run against. */
export function sqlDocument(content: string): Thenable<vscode.TextDocument> {
	return vscode.workspace.openTextDocument({ language: 'sql', content });
}
