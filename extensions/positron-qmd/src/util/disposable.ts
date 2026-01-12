/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * A store of disposables.
 */
export class DisposableStore implements vscode.Disposable {
	private _disposables = new Set<vscode.Disposable>();

	public add<T extends vscode.Disposable>(disposable: T): T {
		this._disposables.add(disposable);
		return disposable;
	}

	public dispose(): void {
		for (const disposable of this._disposables) {
			disposable.dispose();
		}
		this._disposables.clear();
	}
}

/**
 * Base class for objects that need to manage disposable resources.
 * Extend this class and use _register() to track disposables.
 */
export abstract class Disposable implements vscode.Disposable {
	private _isDisposed = false;

	protected readonly _disposables = new DisposableStore();

	public dispose(): void {
		if (this._isDisposed) {
			return;
		}
		this._isDisposed = true;
		this._disposables.dispose();
	}

	protected _register<T extends vscode.Disposable>(value: T): T {
		if (this._isDisposed) {
			value.dispose();
		} else {
			this._disposables.add(value);
		}
		return value;
	}

	protected get isDisposed() {
		return this._isDisposed;
	}
}
