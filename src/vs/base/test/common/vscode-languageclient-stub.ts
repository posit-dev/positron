/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal stub for the 'vscode-languageclient' and 'vscode-languageclient/node' modules
 * used by vitest tests that transitively depend on extension code importing the language client.
 */

const noop = () => { };

export const State = {
	Stopped: 1,
	Starting: 3,
	Running: 2,
};

export const RevealOutputChannelOn = {
	Info: 1,
	Warn: 2,
	Error: 3,
	Never: 4,
};

export const ErrorAction = {
	Continue: 1,
	Shutdown: 2,
};

export const CloseAction = {
	DoNotRestart: 1,
	Restart: 2,
};

export class RequestType {
	constructor(public method: string) { }
}

export class NotificationType {
	constructor(public method: string) { }
}

export class LanguageClient {
	constructor(..._args: unknown[]) { }
	start() { return Promise.resolve(); }
	stop() { return Promise.resolve(); }
	onDidChangeState(_handler: unknown) { return { dispose: noop }; }
	sendRequest(_method: string, ..._args: unknown[]) { return Promise.resolve(null); }
	sendNotification(_method: string, ..._args: unknown[]) { return Promise.resolve(); }
	onNotification(_method: string, _handler: unknown) { return { dispose: noop }; }
	onRequest(_method: string, _handler: unknown) { return { dispose: noop }; }
	get state() { return State.Stopped; }
	get initializeResult() { return undefined; }
}

// Type stubs (values only needed to satisfy runtime, not type checks)
export const Position = class {
	constructor(public line: number, public character: number) { }
};
export const Range = class {
	constructor(public start: unknown, public end: unknown) { }
};
export const VersionedTextDocumentIdentifier = class {
	constructor(public uri: string, public version: number) { }
};

export type Message = unknown;
export type ErrorHandlerResult = { action: number; handled: boolean };

export default { LanguageClient, State, RevealOutputChannelOn, RequestType, NotificationType, ErrorAction, CloseAction };
