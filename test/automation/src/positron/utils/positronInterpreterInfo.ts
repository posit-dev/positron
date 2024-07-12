/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export enum InterpreterType {
	Python = 'Python',
	R = 'R'
}

export interface InterpreterInfo {
	type: InterpreterType;
	version: string;
	path: string;
	source?: string;
}

