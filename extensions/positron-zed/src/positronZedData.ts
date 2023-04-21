/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as vscode from 'vscode';

/**
 * A ZedPLOT instance; simulates a real plot instance by responding to render
 * requests and delivering an SVG image at the requested size.
 */
export class ZedData {
	public readonly id: string;
	constructor(private readonly context: vscode.ExtensionContext) {
		this.id = randomUUID();
	}

	handleMessage(message: any): void {
	}
}
