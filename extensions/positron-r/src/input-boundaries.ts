/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from 'vscode-languageclient/node';

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
