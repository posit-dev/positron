/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

export class DisposableStore implements vscode.Disposable {

	private _disposables = new Set<vscode.Disposable>();

	add<T extends vscode.Disposable>(disposable: T): T {
		this._disposables.add(disposable);
		return disposable;
	}

	dispose(): void {
		for (const disposable of this._disposables) {
			disposable.dispose();
		}

		this._disposables.clear();
	}
}
