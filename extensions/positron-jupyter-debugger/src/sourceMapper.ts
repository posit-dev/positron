/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { murmurhash2_32 } from './murmur.js';

export interface SourceMapOptions {
	/* The hash method used for code cells. Default is 'Murmur2'. */
	hashMethod: string;

	/* The seed for hashing code cells. */
	hashSeed: number;

	/* Prefix for temporary file names. */
	tmpFilePrefix: string;

	/* Suffix for temporary file names. */
	tmpFileSuffix: string;
}

export class SourceMapper {
	public sourceMapOptions?: SourceMapOptions;

	public setSourceMapOptions(options: SourceMapOptions): void {
		this.sourceMapOptions = options;
	}

	private hash(code: string): string {
		if (!this.sourceMapOptions) {
			throw new Error('Cannot hash code before debug options are initialized');
		}

		switch (this.sourceMapOptions.hashMethod) {
			case 'Murmur2':
				return murmurhash2_32(code, this.sourceMapOptions.hashSeed).toString();
			default:
				throw new Error(`Unsupported hash method: ${this.sourceMapOptions.hashMethod}`);
		}
	}

	public getRuntimeSourcePath(code: string): string {
		if (!this.sourceMapOptions) {
			throw new Error('Cannot get code ID before debug options are initialized');
		}

		const hashed = this.hash(code);
		return `${this.sourceMapOptions.tmpFilePrefix}${hashed}${this.sourceMapOptions.tmpFileSuffix}`;
	}
}

