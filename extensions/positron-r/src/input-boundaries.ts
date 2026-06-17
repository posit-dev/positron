/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { LanguageClient, RequestType } from 'vscode-languageclient/node';

export interface InputBoundariesParams {
	text: string;
}

export interface InputBoundaryRange {
	start: number;
	end: number;
}

export type InputBoundaryKind = 'whitespace' | 'complete' | 'incomplete' | 'invalid';

export interface InputBoundary {
	range: InputBoundaryRange;
	kind: InputBoundaryKind;
	data?: {
		message?: string;
	};
}

export interface InputBoundariesResponse {
	boundaries: InputBoundary[];
}

export namespace InputBoundariesRequest {
	export const type = new RequestType<InputBoundariesParams, InputBoundariesResponse, any>('positron/inputBoundaries');
}

/**
 * Provides R input boundaries through the Ark LSP.
 */
export class RInputBoundaryProvider implements positron.InputBoundaryProvider {
	constructor(
		private readonly _client: LanguageClient,
	) { }

	async provideInputBoundaries(
		document: vscode.TextDocument,
		range: vscode.Range,
		token: vscode.CancellationToken
	): Promise<positron.InputBoundary[]> {
		const text = document.getText(range);
		const response = await this._client.sendRequest(InputBoundariesRequest.type, { text }, token);

		return response.boundaries;
	}
}
