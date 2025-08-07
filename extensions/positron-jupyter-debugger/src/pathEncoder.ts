/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { murmurhash2_32 } from './murmur.js';
import { Disposable } from './util.js';

export interface PathEncoderOptions {
	/* The hash method used. Default is 'Murmur2'. */
	hashMethod: string;

	/* The seed for hashing. */
	hashSeed: number;

	/* Prefix for temporary file names. */
	tmpFilePrefix: string;

	/* Suffix for temporary file names. */
	tmpFileSuffix: string;
}

/*
 * Deterministically encodes arbitrary strings into file paths.
 */
export class PathEncoder extends Disposable implements vscode.Disposable {
	private readonly _onDidUpdateOptions = this._register(new vscode.EventEmitter<void>());

	/* Current encoding options. */
	private _options?: PathEncoderOptions;

	constructor() {
		super();
	}

	/* Event fired when encoding options are updated. */
	public readonly onDidUpdateOptions = this._onDidUpdateOptions.event;

	/**
	 * Sets the encoding options for generating paths.
	 * @param options The encoding options.
	 */
	public setOptions(options: PathEncoderOptions): void {
		this._options = options;
		this._onDidUpdateOptions.fire();
	}

	/**
	 * Deterministically encodes a string into a file path.
	 * @param string The string to encode.
	 * @returns A file path generated from the hashed string with configured prefix and suffix.
	 */
	public encode(string: string): string {
		if (!this._options) {
			throw new Error('Cannot encode before options are initialized');
		}

		const hashed = this.hash(string);
		return `${this._options.tmpFilePrefix}${hashed}${this._options.tmpFileSuffix}`;
	}

	/* Hashes a string using the configured hash method and seed. */
	private hash(string: string): string {
		if (!this._options) {
			throw new Error('Cannot hash before options are initialized');
		}

		switch (this._options.hashMethod) {
			case 'Murmur2':
				return murmurhash2_32(string, this._options.hashSeed).toString();
			default:
				throw new Error(`Unsupported hash method: ${this._options.hashMethod}`);
		}
	}

}
