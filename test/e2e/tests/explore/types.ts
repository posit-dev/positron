/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ActionRequest {
	action: string;
	params: Record<string, any>;
}

export interface ActionResult {
	success: boolean;
	result?: string;
	error?: string;
	state: AppState;
	duration: number;
}

export interface AppState {
	activeEditor?: string;
	consoleLinesCount?: number;
	lastConsoleOutput?: string;
	variableCount?: number;
	plotVisible?: boolean;
	notifications?: string[];
}
