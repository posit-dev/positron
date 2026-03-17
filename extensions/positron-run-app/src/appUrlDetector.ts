/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { log } from './extension';
import { removeAnsiEscapeCodes } from './utils';
import { extractAppUrlFromString } from './api-utils';

/**
 * Detects an application URL (and optional ready message) from output chunks.
 * Used by both the terminal and console execution paths.
 */
export class AppUrlDetector {
	private _appReady: boolean;
	private _appUrl: URL | undefined;
	private readonly _appReadyMessage: string | undefined;
	private readonly _resolve: (url: URL) => void;

	readonly found: Promise<URL>;

	constructor(
		private readonly _appUrlStrings: string[] | undefined,
		appReadyMessage: string | undefined,
	) {
		this._appReadyMessage = appReadyMessage?.trim();
		this._appReady = !this._appReadyMessage;

		let resolve!: (url: URL) => void;
		this.found = new Promise<URL>((r) => { resolve = r; });
		this._resolve = resolve;
	}

	/** @returns `true` when the URL has been found and the app is ready. */
	processOutput(data: string): boolean {
		const dataCleaned = removeAnsiEscapeCodes(data);

		if (!this._appReady && this._appReadyMessage) {
			this._appReady = dataCleaned.includes(this._appReadyMessage);
			if (this._appReady) {
				log.debug(`App is ready - found appReadyMessage: '${this._appReadyMessage}'`);
				if (this._appUrl) {
					this._resolve(this._appUrl);
					return true;
				}
			}
		}

		if (!this._appUrl) {
			const match = extractAppUrlFromString(dataCleaned, this._appUrlStrings);
			if (match) {
				this._appUrl = new URL(match);
				log.debug(`Found app URL in output: ${this._appUrl.toString()}`);
				if (this._appReady) {
					this._resolve(this._appUrl);
					return true;
				}
			}
		}

		return false;
	}
}
