/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { toDisposable } from 'vs/base/common/lifecycle';
import { randomPort } from 'vs/base/common/ports';
import { URI } from 'vs/base/common/uri';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { IExtHostTerminalService } from 'vs/workbench/api/common/extHostTerminalService';
import { ExtHostEditors } from 'vs/workbench/api/common/extHostTextEditors';
import { IExtHostWindow } from 'vs/workbench/api/common/extHostWindow';
import { ExtHostLanguageRuntime } from 'vs/workbench/api/common/positron/extHostLanguageRuntime';
import { ExtHostPreviewPanels } from 'vs/workbench/api/common/positron/extHostPreviewPanels';
import * as vscode from 'vscode';

export abstract class AbstractExtHostApplications {

	private readonly _runners = new Map<string, positron.ApplicationRunner>();

	constructor(
		private readonly _editors: ExtHostEditors,
		private readonly _terminalService: IExtHostTerminalService,
		private readonly _languageRuntime: ExtHostLanguageRuntime,
		private readonly _previewPanels: ExtHostPreviewPanels,
		private readonly _window: IExtHostWindow,
	) { }

	public registerApplicationRunner(id: string, runner: positron.ApplicationRunner): vscode.Disposable {
		if (this._runners.has(id)) {
			throw new Error(`Runner with id '${id}' already registered`);
		}

		this._runners.set(id, runner);

		return toDisposable(() => {
			this._runners.delete(id);
		});
	}

	public async runApplication(extension: IExtensionDescription, id: string): Promise<void> {
		const runner = this._runners.get(id);
		if (!runner) {
			throw new Error(`Unknown runner with id: ${id}`);
		}

		console.log(`Running ${runner.label} App...`);

		const document = this._editors.getActiveTextEditor()?.document;
		if (!document) {
			return;
		}

		if (document.isDirty) {
			await document.save();
		}

		// TODO: Check for a port setting?
		// TODO: Cache used port?
		const port = await this.findFreePort(randomPort(), 10, 3000);

		const oldTerminals = this._terminalService.terminals.filter((t) => t.name === runner.label);

		const runtime = await this._languageRuntime.getPreferredRuntime(runner.languageId);

		const commandOptions = runner.getRunOptions(runtime.runtimePath, document, port);

		const terminal = this._terminalService.createTerminalFromOptions({
			name: runner.label,
			env: commandOptions.env,
		});
		terminal.show(true);

		const closingTerminals = oldTerminals.map((x) => {
			const p = new Promise<void>((resolve) => {
				// Resolve when the terminal is closed. We're working hard to be accurate
				// BUT empirically it doesn't seem like the old Shiny processes are
				// actually terminated at the time this promise is resolved, so callers
				// shouldn't assume that.
				const subscription = this._terminalService.onDidCloseTerminal((term) => {
					if (term === x) {
						subscription.dispose();
						resolve();
					}
				});
			});
			x.dispose();
			return p;
		});
		await Promise.allSettled(closingTerminals);

		// TODO: Escape the command for the terminal.
		// const cmdline = escapeCommandForTerminal(terminal, python, args);
		console.log('Command:', commandOptions.command);
		terminal.sendText(commandOptions.command);

		this._previewPanels.previewUrl(extension, URI.parse('about:blank'));

		// TODO: Handle being in workbench.
		const localUri = URI.parse(commandOptions.url ?? `http://localhost:${port}`);
		let uri: URI;
		try {
			// TODO: Pass through initData.remote.authority
			// { allowTunneling: !!initData.remote.authority }
			uri = await this._window.asExternalUri(localUri, {});
		} catch (error) {
			uri = localUri;
		}

		await this.waitForPortConnection(port, 10_000);

		this._previewPanels.previewUrl(extension, uri);
	}

	protected abstract findFreePort(startPort: number, maxTries: number, timeout: number): Promise<number>;

	protected abstract waitForPortConnection(port: number, timeout: number): Promise<void>;
}

export type ExtHostApplicationsConstructor = new (
	editors: ExtHostEditors,
	terminalService: IExtHostTerminalService,
	languageRuntime: ExtHostLanguageRuntime,
	previewPanels: ExtHostPreviewPanels,
	window: IExtHostWindow,
) => AbstractExtHostApplications;
