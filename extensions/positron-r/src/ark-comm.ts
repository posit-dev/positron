/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { JupyterLanguageRuntimeSession, RawComm } from './positron-supervisor';
import { LOGGER } from './extension';

/**
 * Communication channel with the bakend.
 * Currently only used for testing.
 */
export class ArkComm implements vscode.Disposable {
	readonly targetName: string = 'ark';

	public get comm(): RawComm | undefined {
		return this._comm;
	}

	private _comm?: RawComm;

	constructor(
		private session: JupyterLanguageRuntimeSession,
	) { }

	async createComm(): Promise<void> {
		this._comm = await this.session.createComm(this.targetName);
		LOGGER.info(`Created Ark comm with ID: ${this._comm.id}`);
	}

	async dispose(): Promise<void> {
		await this._comm?.dispose();
	}
}
