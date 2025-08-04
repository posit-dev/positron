/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { RSession } from '../session';
import { delay } from '../util';
import { toDisposable } from './utils-disposables';

export async function startR(): Promise<[RSession, vscode.Disposable]> {
	// There doesn't seem to be a method that resolves when a language is
	// both discovered and ready to be started
	let info;

	const startTime = Date.now();
	const timeout = 30000;

	while (true) {
		try {
			info = await positron.runtime.getPreferredRuntime('r');
			if (info) {
				break;
			}
		} catch (_) {
			// Try again
		}

		if (Date.now() - startTime > timeout) {
			throw new Error('Timeout while waiting for preferred R runtime');
		}
		await delay(50);
	}

	const session = await positron.runtime.startLanguageRuntime(info!.runtimeId, 'Tests') as RSession;

	const disposable = toDisposable(async () => {
		await session.shutdown();
		await session.dispose();
	});

	return [session, disposable];
}

/**
 * Executes R code using `positron.runtime.executeCode`.
 * Doesn't take focus and incomplete statements are not allowed.
 * @param src The R code to execute.
 */
export async function execute(src: string) {
	await positron.runtime.executeCode('r', src, false, false);
}
