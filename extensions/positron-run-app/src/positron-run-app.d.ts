/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';

/**
 * Options shared by every {@link RunAppTerminalOptions} variant.
 */
interface RunAppTerminalOptionsBase {
	/**
	 * The optional working directory to create the terminal with. When unset,
	 * the terminal inherits the default working directory (typically the
	 * workspace root).
	 */
	cwd?: string;

	/**
	 * The optional environment variables to create the terminal with.
	 */
	env?: { [key: string]: string | null | undefined };
}

/**
 * Options returned from ${@link RunAppOptions.getTerminalOptions}.
 *
 * Provide the command to run in exactly one of two ways (the two forms are
 * mutually exclusive):
 *
 * - {@link RunAppTerminalCommandLineOptions.commandLine commandLine}: a
 *   pre-escaped command line string. The caller is responsible for
 *   shell-escaping any paths or arguments.
 * - {@link RunAppTerminalCommandOptions.command command} (with optional
 *   {@link RunAppTerminalCommandOptions.args args}): the executable and its
 *   arguments as separate values. positron-run-app builds the command line and
 *   applies shell-appropriate escaping for the terminal's shell, so callers
 *   don't have to worry about spaces in interpreter or application paths.
 *
 * Prefer the {@link RunAppTerminalCommandOptions.command command}/
 * {@link RunAppTerminalCommandOptions.args args} form for new callers.
 */
export type RunAppTerminalOptions =
	| RunAppTerminalCommandLineOptions
	| RunAppTerminalCommandOptions;

/**
 * The pre-escaped command line form of {@link RunAppTerminalOptions}.
 */
export interface RunAppTerminalCommandLineOptions extends RunAppTerminalOptionsBase {
	/**
	 * The command line to run in the terminal. Must already be escaped for the
	 * target shell.
	 */
	commandLine: string;

	command?: never;
	args?: never;
}

/**
 * The executable-and-arguments form of {@link RunAppTerminalOptions}, escaped
 * for the terminal's shell by positron-run-app.
 */
export interface RunAppTerminalCommandOptions extends RunAppTerminalOptionsBase {
	/**
	 * The executable to run (e.g. an interpreter path). positron-run-app escapes
	 * {@link command} and {@link args} for the terminal's shell and runs the
	 * resulting command line.
	 */
	command: string;

	/**
	 * The arguments to pass to {@link command}. Each argument is escaped
	 * independently for the terminal's shell.
	 */
	args?: string[];

	commandLine?: never;
}

/**
 * Code returned from ${@link RunConsoleAppOptions.getConsoleCode}.
 */
export interface RunAppConsoleCode {
	/**
	 * The code to execute in the console session.
	 */
	code: string;
}

/**
 * How to preview the application once the URL is detected.
 *
 * - `'viewer'`   — open in the Positron Viewer pane.
 * - `'editor'`   — open in an editor tab.
 * - `'external'` — open in an external browser.
 * - `'none'`     — skip URL detection and preview entirely.
 * - `'manual'`   — detect the URL but return it to the caller
 *                   instead of previewing.
 */
export type PreviewMode = 'viewer' | 'editor' | 'external' | 'none' | 'manual';

/**
 * Shared options for running an application.
 */
interface RunAppOptionsBase {
	/**
	 * The human-readable label for the application e.g. `'Streamlit'`.
	 */
	name: string;

	/**
	 * The document to run. When omitted, the active editor's document is used.
	 */
	document?: vscode.TextDocument;

	/**
	 * How to preview the application once the URL is detected.
	 *
	 * Defaults to `'default'`, which resolves to the user's
	 * `positron.runApp.previewMode` setting (initially `'viewer'`).
	 */
	preview?: PreviewMode | 'default';

	/**
	 * The optional URL path at which to preview the application.
	 */
	urlPath?: string;

	/**
	 * The optional app ready message to wait for before previewing the application.
	 */
	appReadyMessage?: string;

	/**
	 * An optional array of app URI formats to parse the URI from the output.
	 */
	appUrlStrings?: string[];

	/**
	 * The debug adapter type (e.g. `'ark'`) used by the runtime. When set
	 * and breakpoints are present, the runner waits for that adapter's
	 * `configurationDone` before executing app code. Leave unset for
	 * runtimes without DAP support to avoid a waiting overhead on every run.
	 */
	debugAdapterType?: string;

	/**
	 * Optional timeout in milliseconds for URL detection in application output.
	 * If not specified, a default timeout is used.
	 */
	urlDetectionTimeout?: number;
}

/**
 * Options for the ${@link PositronRunApp.runApplication} function.
 */
export interface RunAppOptions extends RunAppOptionsBase {
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
}

/**
 * Options for the ${@link PositronRunApp.runApplicationInConsole} function.
 */
export interface RunConsoleAppOptions extends RunAppOptionsBase {
	/**
	 * A function that will be called to get the code to execute in the console session.
	 *
	 * @param runtime The language runtime metadata for the document's language.
	 * @param document The document to run.
	 * @param urlPrefix The URL prefix to use, if known.
	 * @returns The console code for running the application. Return `undefined` to abort the run.
	 */
	getConsoleCode: (
		runtime: positron.LanguageRuntimeMetadata,
		document: vscode.TextDocument,
		urlPrefix?: string,
	) => RunAppConsoleCode | undefined | Promise<RunAppConsoleCode | undefined>;
}

/**
 * Options for the ${@link PositronRunApp.debugApplication} function.
 */
export interface DebugAppOptions {
	/**
	 * The human-readable label for the application e.g. `'Streamlit'`.
	 */
	name: string;

	/**
	 * The document to debug. When omitted, the active editor's document is used.
	 */
	document?: vscode.TextDocument;

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
	 * How to preview the application once the URL is detected.
	 *
	 * Defaults to `'default'`, which resolves to the user's
	 * `positron.runApp.previewMode` setting (initially `'viewer'`).
	 */
	preview?: PreviewMode | 'default';

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

	/**
	 * Optional timeout in milliseconds for URL detection in application output.
	 * If not specified, a default timeout is used.
	 */
	urlDetectionTimeout?: number;
}

/**
 * The public API of the Positron Run App extension.
 */
export interface PositronRunApp {
	/**
	 * Run an application in the terminal.
	 *
	 * @param options Options for running the application.
	 * @returns If terminal shell integration is supported, resolves when the
	 *  application server has started, otherwise resolves when the command has
	 *  been sent to the terminal. When `preview` is `'manual'`, resolves with
	 *  the detected URL (rejects if detection fails).
	 */
	runApplication(options: RunAppOptions): Promise<vscode.Uri | undefined>;

	/**
	 * Run an application in a new console session.
	 *
	 * @param options Options for running the application.
	 * @returns Resolves when the application server has started, or when the
	 *  code has been sent to the console if URL detection times out. When
	 *  `preview` is `'manual'`, resolves with the detected URL (rejects if
	 *  detection fails).
	 */
	runApplicationInConsole(options: RunConsoleAppOptions): Promise<vscode.Uri | undefined>;

	/**
	 * Debug an application.
	 *
	 * @param options Options for debugging the application.
	 * @returns If terminal shell integration is supported, resolves when the application server has
	 *  started, otherwise resolves when the debug session has started.
	 */
	debugApplication(options: DebugAppOptions): Promise<void>;
}
