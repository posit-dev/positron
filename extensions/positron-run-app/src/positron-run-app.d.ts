/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';

/**
 * Represents options returned from ${@link RunAppOptions.getTerminalOptions}.
 */
export interface RunAppTerminalOptions {
	/**
	 * The command line to run in the terminal.
	 */
	commandLine: string;

	/**
	 * The optional environment variables to create the terminal with.
	 */
	env?: { [key: string]: string | null | undefined };
}

/**
 * Represents options for the ${@link PositronRunApp.runApplication} function.
 */
export interface RunAppOptions {
	/**
	 * The human-readable label for the application e.g. `'Streamlit'`, also used as the ${@link vscode.Terminal.name}.
	 */
	name: string;

	/**
	 * A function that will be called to get the terminal options for running the application.
	 *
	 * @param runtime The language runtime metadata for the document's language.
	 * @param document The document to run.
	 * @param urlPrefix The URL prefix to use, if known.
	 * @returns The terminal options for running the application. Return `undefined` to abort the run.
	 */
	getTerminalOptions: (
		runtime: positron.LanguageRuntimeMetadata,
		document: vscode.TextDocument,
		urlPrefix?: string,
	) => RunAppTerminalOptions | undefined | Promise<RunAppTerminalOptions | undefined>;

	/**
	 * The optional URL path at which to preview the application.
	 */
	urlPath?: string;

	/**
	 * The optional app ready message to wait for in the terminal before previewing the application.
	 */
	appReadyMessage?: string;

	/**
	 * An optional array of app URI formats to parse the URI from the terminal output.
	 */
	appUrlStrings?: string[];
}

/**
 * Represents options for the ${@link PositronRunApp.debugApplication} function.
 */
export interface DebugAppOptions {
	/**
	 * The human-readable label for the application e.g. `'Streamlit'`.
	 */
	name: string;

	/**
	 * A function that will be called to get the ${@link vscode.DebugConfiguration, debug configuration} for debugging the application.
	 *
	 * @param runtime The language runtime metadata for the document's language.
	 * @param document The document to debug.
	 * @param urlPrefix The URL prefix to use, if known.
	 * @returns The debug configuration for debugging the application. Return `undefined` to abort debugging.
	 */
	getDebugConfiguration(
		runtime: positron.LanguageRuntimeMetadata,
		document: vscode.TextDocument,
		urlPrefix?: string,
	): vscode.DebugConfiguration | undefined | Promise<vscode.DebugConfiguration | undefined>;

	/**
	 * The optional URL path at which to preview the application.
	 */
	urlPath?: string;

	/**
	 * The optional app ready message to wait for in the terminal before previewing the application.
	 */
	appReadyMessage?: string;

	/**
	 * An optional array of app URI formats to parse the URI from the terminal output.
	 */
	appUrlStrings?: string[];
}

/**
 * The public API of the Positron Run App extension.
 */
export interface PositronRunApp {
	/**
	 * Run an application in the terminal.
	 *
	 * @param options Options for running the application.
	 * @returns If terminal shell integration is supported, resolves when the application server has
	 *  started, otherwise resolves when the command has been sent to the terminal.
	 */
	runApplication(options: RunAppOptions): Promise<void>;

	/**
	 * Debug an application.
	 *
	 * @param options Options for debugging the application.
	 * @returns If terminal shell integration is supported, resolves when the application server has
	 *  started, otherwise resolves when the debug session has started.
	 */
	debugApplication(options: DebugAppOptions): Promise<void>;
}
