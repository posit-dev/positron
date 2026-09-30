/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { SqlAnalyzer } from './analyzer';
import { SqlLog } from './log';
import { SqlStatementRangeProvider } from './statementRange';

/** The configuration section every setting this extension reads lives under. */
const CONFIGURATION_SECTION = 'sql';

/** The compiled analyzer, built from `sql-analyzer/` and committed; see scripts/build-analyzer.mts. */
const ANALYZER_MODULE = path.join('resources', 'sql-analyzer.wasm');

/** Documents this extension provides features for: every SQL document, whatever its scheme. */
const SQL_DOCUMENTS: vscode.DocumentSelector = { language: 'sql' };

export function activate(context: vscode.ExtensionContext): void {
	const log = vscode.window.createOutputChannel('SQL', { log: true });
	context.subscriptions.push(log);

	const session = new SqlSession(context, log);
	context.subscriptions.push(session);
	session.start();
}

export function deactivate(): void { }

/**
 * The extension's state and the editor features that read it.
 *
 * All of it lives in this process: the parser is a WebAssembly module (see `analyzer.ts`) rather
 * than a language server, so there is nothing to launch, supervise or keep in step with the
 * user's settings -- a setting is simply read the next time a feature runs.
 */
class SqlSession implements vscode.Disposable {

	private readonly _disposables: vscode.Disposable[] = [];

	/** Compiled on first use: it takes a moment, and activation should not wait for it. */
	private _analyzer: SqlAnalyzer | undefined;

	/**
	 * Set once the module has failed to load, so the failure is reported once rather than on
	 * every keystroke, and not retried on every request either.
	 */
	private _analyzerUnavailable = false;

	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _log: SqlLog,
	) { }

	public start(): void {
		this._disposables.push(
			// Registered for every SQL document, whatever its scheme, so that statements can be
			// sent to the Console from a file, an untitled buffer or a notebook cell.
			positron.languages.registerStatementRangeProvider(
				SQL_DOCUMENTS,
				new SqlStatementRangeProvider(
					() => this._require(),
					() => this._dialect(),
				),
			),
		);
	}

	public dispose(): void {
		for (const disposable of this._disposables) {
			disposable.dispose();
		}
	}

	/**
	 * The analyzer, loaded on the first request that needs it.
	 *
	 * Throws rather than returning undefined: the statement range provider has nothing useful to
	 * answer without it, and the editor reports the failure where the user asked for the range.
	 */
	private _require(): SqlAnalyzer {
		if (this._analyzer) {
			return this._analyzer;
		}
		const module = path.join(this._context.extensionPath, ANALYZER_MODULE);
		if (this._analyzerUnavailable) {
			throw new Error(`The SQL analyzer at ${module} could not be loaded.`);
		}
		try {
			this._analyzer = SqlAnalyzer.load(module, message => this._log.error(message));
		} catch (error) {
			// Once: the module is read from disk at a fixed path, so a second attempt would fail
			// the same way and say so again on every keystroke.
			this._analyzerUnavailable = true;
			this._log.error(`Could not load the SQL analyzer from ${module}, so SQL statement`
				+ ` ranges are unavailable: ${error}`);
			throw error;
		}
		return this._analyzer;
	}

	/** The dialect to parse in, which for now is whatever the user has set. */
	private _dialect(): string {
		return vscode.workspace.getConfiguration(CONFIGURATION_SECTION).get<string>('dialect') ?? '';
	}
}
