/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal stub for the 'vscode' module used by vitest tests that transitively
 * depend on extension code importing vscode. Only implements the subset of APIs
 * that are called at module initialization time.
 */

const noop = () => { };
const noopChannel = {
	logLevel: 0,
	onDidChangeLogLevel: noop,
	name: 'stub',
	append: noop,
	appendLine: noop,
	replace: noop,
	clear: noop,
	show: noop,
	hide: noop,
	dispose: noop,
	trace: noop,
	debug: noop,
	info: noop,
	warn: noop,
	error: noop,
};

export const window = {
	createOutputChannel: () => noopChannel,
	showErrorMessage: () => Promise.resolve(undefined),
	showInformationMessage: () => Promise.resolve(undefined),
	showWarningMessage: () => Promise.resolve(undefined),
};

export const l10n = {
	t: (message: string, ..._args: any[]) => message,
};

export const workspace = {
	getConfiguration: () => ({
		get: (_key: string, defaultValue?: unknown) => defaultValue,
	}),
};

export const authentication = {
	getSession: () => Promise.resolve(undefined),
};

export const Uri = {
	file: (path: string) => ({ fsPath: path, scheme: 'file', toString: () => path }),
	parse: (uri: string) => ({ fsPath: uri, scheme: 'file', toString: () => uri }),
};

export const EventEmitter = class {
	event = () => ({ dispose: noop });
	fire = noop;
	dispose = noop;
};

export enum LogLevel {
	Off = 0,
	Trace = 1,
	Debug = 2,
	Info = 3,
	Warning = 4,
	Error = 5,
}

export enum ViewColumn {
	Active = -1,
	Beside = -2,
	One = 1,
}

export const Disposable = {
	from: (...args: any[]) => ({ dispose: noop }),
};

export const commands = {
	registerCommand: () => ({ dispose: noop }),
	executeCommand: () => Promise.resolve(undefined),
};

export const extensions = {
	getExtension: () => undefined,
};

export const env = {
	language: 'en',
	appName: 'stub',
};

export const CancellationTokenSource = class {
	token = { isCancellationRequested: false, onCancellationRequested: noop };
	cancel = noop;
	dispose = noop;
};

export const ThemeIcon = class {
	constructor(public id: string) { }
};
