/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { murmurhash2_32 } from './murmur.js';
import { DisposableStore } from './util.js';

export interface PathEncoderOptions {
	/* The hash method used for code cells. Default is 'Murmur2'. */
	hashMethod: string;

	/* The seed for hashing code cells. */
	hashSeed: number;

	/* Prefix for temporary file names. */
	tmpFilePrefix: string;

	/* Suffix for temporary file names. */
	tmpFileSuffix: string;
}

export class PathEncoder implements vscode.Disposable {
	private readonly _disposables = new DisposableStore();

	private readonly _onDidUpdateOptions = this._disposables.add(new vscode.EventEmitter<void>());

	public readonly onDidUpdateOptions = this._onDidUpdateOptions.event;

	private _options?: PathEncoderOptions;

	public setOptions(options: PathEncoderOptions): void {
		this._options = options;
		this._onDidUpdateOptions.fire();
	}

	private hash(string: string): string {
		if (!this._options) {
			throw new Error('Cannot hash code before debug options are initialized');
		}

		switch (this._options.hashMethod) {
			case 'Murmur2':
				return murmurhash2_32(string, this._options.hashSeed).toString();
			default:
				throw new Error(`Unsupported hash method: ${this._options.hashMethod}`);
		}
	}

	public encode(string: string): string {
		if (!this._options) {
			throw new Error('Cannot get code ID before debug options are initialized');
		}

		const hashed = this.hash(string);
		return `${this._options.tmpFilePrefix}${hashed}${this._options.tmpFileSuffix}`;
	}

	public dispose() {
		this._disposables.dispose();
	}
}
