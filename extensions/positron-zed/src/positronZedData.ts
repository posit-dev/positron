/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as vscode from 'vscode';

/**
 * A Zed column
 */
class ZedColumn {
	public readonly name: string;
	public readonly type: string;
	public readonly data: Array<number>;
	constructor(name: string, type: string, length: number) {
		this.name = name;
		this.type = type;
		// Create an array of random numbers of the requested length
		this.data = Array.from({ length }, () => Math.floor(Math.random() * 100));
	}
}

/**
 * A ZedPLOT instance; simulates a real plot instance by responding to render
 * requests and delivering an SVG image at the requested size.
 */
export class ZedData {
	public readonly id: string;
	public readonly data: Array<ZedColumn> = [];
	constructor(private readonly context: vscode.ExtensionContext,
		private readonly nrow = 100,
		private readonly ncol = 10) {
		// Create a unique ID for this instance
		this.id = randomUUID();

		// Create the requested number of columns
		for (let i = 0; i < ncol; i++) {
			this.data.push(new ZedColumn(`Column ${i}`, 'int32', nrow));
		}
	}

	handleMessage(message: any): void {
	}
}
