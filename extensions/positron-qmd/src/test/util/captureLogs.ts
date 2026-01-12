/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { Disposable } from '../../util/disposable.js';

/**
 * A LogOutputChannel that redirects logs to the console for easy viewing in extension tests.
 */
class CapturingLogOutputChannel extends Disposable implements vscode.LogOutputChannel {
	private readonly prefix: string;
	private readonly _onDidChangeLogLevel = this._register(new vscode.EventEmitter<vscode.LogLevel>());

	readonly name: string;
	readonly logLevel = vscode.LogLevel.Trace;
	readonly onDidChangeLogLevel = this._onDidChangeLogLevel.event;

	constructor(name: string) {
		super();
		this.name = name;
		this.prefix = `[${name}]`;
	}

	trace(message: string, ...args: any[]): void {
		console.debug(this.prefix, message, ...args);
	}

	debug(message: string, ...args: any[]): void {
		console.debug(this.prefix, message, ...args);
	}

	info(message: string, ...args: any[]): void {
		console.info(this.prefix, message, ...args);
	}

	warn(message: string, ...args: any[]): void {
		console.warn(this.prefix, message, ...args);
	}

	error(message: string | Error, ...args: any[]): void {
		console.error(this.prefix, message, ...args);
	}

	append(value: string): void {
		process.stdout.write(value);
	}

	appendLine(value: string): void {
		console.log(this.prefix, value);
	}

	replace(): void { /* no-op */ }
	clear(): void { /* no-op */ }
	show(): void { /* no-op */ }
	hide(): void { /* no-op */ }
}

/**
 * Call this inside a test suite to redirect log output channels to console.
 */
export function captureLogs(): void {
	let stub: sinon.SinonStub | undefined;

	suiteSetup(() => {
		const original = vscode.window.createOutputChannel;
		stub = sinon.stub(vscode.window, 'createOutputChannel').callsFake(
			(name: string, options?: any) => {
				if (options && typeof options === 'object' && options.log === true) {
					return new CapturingLogOutputChannel(name);
				}
				return original.call(vscode.window, name, options);
			}
		);
	});

	suiteTeardown(() => {
		if (stub) {
			stub.restore();
			stub = undefined;
		}
	});
}
