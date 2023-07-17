/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { trace } from './logging';
import * as Net from 'net';

/**
 * The state of the debug adapter server.
 */
export enum DapState {
	uninitialized = 'uninitialized',
	starting = 'starting',
	stopped = 'stopped',
	running = 'running',
}

/**
 * Wraps an instance of the client side of the ARK DAP.
 */
export class ArkDap implements vscode.Disposable {
	// WIP
	private _state: DapState = DapState.uninitialized;

	public constructor(private readonly _version: string) {
	}

	/**
	 * Activate the debug server; returns a promise that resolves when the DAP is
	 * activated.
	 *
	 * @param port The port on which the language server is listening.
	 * @param context The VSCode extension context.
	 */
	public async activate(
		port: number,
		context: vscode.ExtensionContext
	): Promise<void> {
		trace(`Attaching to Positron R debug adapter on port ${port}`);
		// Create a config dynamically because we are not
		// relying on a `launch.json` configuration file
		const config = {
			type: 'ark',
			name: 'Ark Positron R',
			request: 'attach',
			debugServer: port,
		} as vscode.DebugConfiguration;
		await vscode.debug.startDebugging(undefined, config);
	}

	/**
	 * Stops the client instance.
	 *
	 * @returns A promise that resolves when the client has been stopped.
	 */
	public async deactivate() {
	}

	/**
	 * Gets the current state of the client.
	 */
	get state(): DapState {
		return this._state;
	}

	/**
	 * Dispose of the client instance.
	 */
	async dispose() {
		await this.deactivate();
	}
}
