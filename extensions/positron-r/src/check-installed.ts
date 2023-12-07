/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { RRuntime } from './runtime';
import { timeout } from './util';
import { randomUUID } from 'crypto';

export async function checkInstalled(runtime: RRuntime, pkgName: string, intendedUse: string): Promise<boolean> {
	const isInstalled = await runtime.callMethod('is_installed', pkgName);
	if (!isInstalled) {
		const install = await positron.window.showSimpleModalDialogPrompt(
			'Missing R package',
			`Package ${pkgName} required but not installed.`,
			'Install now'
		);
		if (install) {
			const id = randomUUID();

			// A promise that resolves when the runtime is idle:
			const promise = new Promise<void>(resolve => {
				const disp = runtime.onDidReceiveRuntimeMessage(runtimeMessage => {
					if (runtimeMessage.parent_id === id &&
						runtimeMessage.type === positron.LanguageRuntimeMessageType.State) {
						const runtimeMessageState = runtimeMessage as positron.LanguageRuntimeState;
						if (runtimeMessageState.state === positron.RuntimeOnlineState.Idle) {
							resolve();
							disp.dispose();
						}
					}
				});
			});

			runtime.execute(`install.packages("${pkgName}")`,
				id,
				positron.RuntimeCodeExecutionMode.Interactive,
				positron.RuntimeErrorBehavior.Continue);

			// Wait for the the runtime to be idle, or for the timeout:
			await Promise.race([promise, timeout(2e4, 'waiting for package installation')]);

			return true;
		} else {
			vscode.window.showWarningMessage(`Cannot ${intendedUse} without ${pkgName} package.`);
			return false;
		}
	}
	return true;
}
