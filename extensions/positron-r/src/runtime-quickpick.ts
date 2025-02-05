/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { rRuntimeDiscoverer, RRuntimeSource } from './provider';
import { RRuntimeManager } from './runtime-manager';

class RuntimeQuickPickItem implements vscode.QuickPickItem {

	label: string;
	description: string;
	runtime: positron.LanguageRuntimeMetadata;

	constructor(
		public runtimeMetadata: positron.LanguageRuntimeMetadata,
	) {
		this.label = runtimeMetadata.runtimeName;
		this.description = runtimeMetadata.runtimePath;
		this.runtime = runtimeMetadata;
	}
}

export async function quickPickRuntime(runtimeManager: RRuntimeManager) {

	const runtime = await new Promise<positron.LanguageRuntimeMetadata | undefined>(
		async (resolve) => {
			const disposables: vscode.Disposable[] = [];

			// Set up the quick pick
			const input = vscode.window.createQuickPick<RuntimeQuickPickItem | vscode.QuickPickItem>();
			input.title = vscode.l10n.t('Select Interpreter');
			input.canSelectMany = false;
			input.matchOnDescription = true;

			// R discovery is fast so we just do it before rendering the quick pick
			const runtimePicks: RuntimeQuickPickItem[] = [];
			const discoverer = rRuntimeDiscoverer();
			for await (const runtime of discoverer) {
				runtimePicks.push(new RuntimeQuickPickItem(runtime));
			}
			// Update the quick pick items with the source
			const runtimeSourceOrder: string[] = Object.values(RRuntimeSource);
			runtimePicks.sort((a, b) => {
				return runtimeSourceOrder.indexOf(a.runtime.runtimeSource) - runtimeSourceOrder.indexOf(b.runtime.runtimeSource);
			});
			const picks = new Array<vscode.QuickPickItem | RuntimeQuickPickItem>();
			for (const source of runtimeSourceOrder) {
				const separatorItem: vscode.QuickPickItem = { label: source, kind: vscode.QuickPickItemKind.Separator };
				picks.push(separatorItem);
				for (const item of runtimePicks) {
					if (item.runtime.runtimeSource === source) {
						picks.push(item);
					}
				}
			}

			input.items = picks;

			// If we have a preferred runtime, select it
			const preferredRuntime = await positron.runtime.getPreferredRuntime('r');
			if (preferredRuntime) {
				input.placeholder = vscode.l10n.t('Selected Interpreter: {0}', preferredRuntime.runtimeName);
				const activeItem = runtimePicks.find(
					(item) => item.runtimeMetadata.runtimeId === preferredRuntime.runtimeId
				);
				if (activeItem) {
					input.activeItems = [activeItem];
				}
			}

			disposables.push(
				input.onDidAccept(() => {
					const activeItem = input.activeItems[0] as RuntimeQuickPickItem;
					resolve(activeItem.runtime);
					input.hide();
				}),
				input.onDidHide(() => {
					resolve(undefined);
					input.dispose();
				}),
			);
			input.show();
		});

	// If we did in fact get a runtime from the user, select and start it
	if (runtime) {
		runtimeManager.registerLanguageRuntime(runtime);
		positron.runtime.selectLanguageRuntime(runtime.runtimeId);
	}
};
