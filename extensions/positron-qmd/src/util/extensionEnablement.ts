/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from './disposable.js';

/**
 * Manages conditional activation of the extension based on an enablement setting.
 */
export class ExtensionEnablement extends Disposable {
	private _activationDisposable: vscode.Disposable | undefined;

	constructor(
		private readonly _configSection: string,
		private readonly _configKey: string,
		private readonly _activateCallback: () => vscode.Disposable,
		private readonly _log: vscode.LogOutputChannel,
	) {
		super();

		// Subscribe to configuration changes
		this._register(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration(`${_configSection}.${_configKey}`)) {
					if (this._isEnabled()) {
						this._activate();
					} else {
						this._deactivate();
					}
				}
			})
		);

		// Activate if already enabled
		if (this._isEnabled()) {
			this._activate();
		}
	}

	/** Whether the extension features are currently active. */
	get isActive(): boolean {
		return this._activationDisposable !== undefined;
	}

	private _isEnabled(): boolean {
		return vscode.workspace
			.getConfiguration(this._configSection)
			.get<boolean>(this._configKey, false);
	}

	private _activate(): void {
		if (!this._activationDisposable) {
			this._activationDisposable = this._activateCallback();
			this._log.info('[ExtensionEnablement] Activated');
		}
	}

	private _deactivate(): void {
		if (this._activationDisposable) {
			this._activationDisposable.dispose();
			this._activationDisposable = undefined;
			this._log.info('[ExtensionEnablement] Deactivated');
		}
	}

	dispose(): void {
		this._deactivate();
		super.dispose();
	}
}
