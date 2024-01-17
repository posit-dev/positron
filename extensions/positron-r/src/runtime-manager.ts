/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import PQueue from 'p-queue';
import { RRuntime } from './runtime';

class RRuntimeManager {
	private runtimes: Map<string, RRuntime> = new Map();
	private lastBinpath = '';

	constructor() { }

	getRuntime(id: string): RRuntime {
		const runtime = this.runtimes.get(id);
		if (!runtime) {
			throw new Error(`Runtime ${id} not found`);
		}
		return runtime;
	}

	setRuntime(id: string, runtime: RRuntime): void {
		this.runtimes.set(id, runtime);
	}

	hasRuntime(id: string): boolean {
		return this.runtimes.has(id);
	}

	setLastBinpath(path: string) {
		this.lastBinpath = path;
	}

	hasLastBinpath(): boolean {
		return this.lastBinpath !== '';
	}

	getLastBinpath(): string {
		return this.lastBinpath;
	}
}

export const runtimeManager: RRuntimeManager = new RRuntimeManager();
