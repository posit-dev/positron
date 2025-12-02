/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

const LSP_OUTPUT_CHANNEL_DESCRIPTOR = 'Language Server';

/**
 * Manages all the R LSP output channels
 *
 * Only cleaned up when Positron is closed. Output channels are persistant so they can be reused
 * between sessions of the same key (session name + session mode), and so you can use them for
 * debugging after a kernel crashes.
 */
export class RLspOutputChannelManager {
	/// Singleton instance
	private static _instance: RLspOutputChannelManager;

	/// Map of keys to OutputChannel instances
	private _channels: Map<string, vscode.OutputChannel> = new Map();

	/// Constructor; private since we only want one of these
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	private constructor() { }

	/**
	 * Accessor for the singleton instance; creates it if it doesn't exist.
	 */
	static get instance(): RLspOutputChannelManager {
		if (!RLspOutputChannelManager._instance) {
			RLspOutputChannelManager._instance = new RLspOutputChannelManager();
		}
		return RLspOutputChannelManager._instance;
	}

	/**
	 * Gets the output channel for the given key. Creates one if the key hasn't been provided yet.
	 *
	 * @param sessionName The session name of the session to get the output channel for.
	 * @param sessionMode The session mode of the session to get the output channel for.
	 * @returns An output channel.
	 */
	getOutputChannel(sessionName: string, sessionMode: string): vscode.OutputChannel {
		const key = `${sessionName}-${sessionMode}`;
		let out = this._channels.get(key);

		if (!out) {
			const name = `${sessionName}: ${LSP_OUTPUT_CHANNEL_DESCRIPTOR} (${sessionMode.charAt(0).toUpperCase() + sessionMode.slice(1)})`;
			out = positron.window.createRawLogOutputChannel(name);
			this._channels.set(key, out);
		}

		return out;
	}
}
