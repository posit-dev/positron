/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Workbench } from './workbench';
import { Code, launch, LaunchOptions } from './code';
import { Logger, measureAndLog } from './logger';
import { Profiler } from './profiler';
import { expect } from '@playwright/test';
import { MenuItem } from 'electron';
import { _electronApp } from './playwrightElectron.js';

export const enum Quality {
	Dev,
	Insiders,
	Stable,
	Exploration,
	OSS
}

export interface ApplicationOptions extends LaunchOptions {
	readonly workspacePath: string;
}

export class Application {

	constructor(private options: ApplicationOptions) {
		this._userDataPath = options.userDataDir;
		this._workspacePathOrFolder = options.workspacePath;
	}

	private _code: Code | undefined;
	get code(): Code { return this._code!; }

	private _workbench: Workbench | undefined;
	get workbench(): Workbench { return this._workbench!; }

	get logger(): Logger {
		return this.options.logger;
	}

	get remote(): boolean {
		return !!this.options.remote;
	}

	get web(): boolean {
		return !!this.options.web;
	}

	private _workspacePathOrFolder: string;
	get workspacePathOrFolder(): string {
		return this._workspacePathOrFolder;
	}

	get extensionsPath(): string {
		return this.options.extensionsPath;
	}

	private _userDataPath: string;
	get userDataPath(): string {
		return this._userDataPath;
	}

	private _profiler: Profiler | undefined;

	get profiler(): Profiler { return this._profiler!; }

	async start(): Promise<void> {
		await this._start();
		await expect(this.code.driver.page.locator('.explorer-folders-view')).toBeVisible();
	}

	async restart(options?: { workspaceOrFolder?: string; extraArgs?: string[] }): Promise<void> {
		await measureAndLog(() => (async () => {
			await this.stop();
			await this._start(options?.workspaceOrFolder, options?.extraArgs);
		})(), 'Application#restart()', this.logger);
	}

	private async _start(workspaceOrFolder = this.workspacePathOrFolder, extraArgs: string[] = []): Promise<void> {
		this._workspacePathOrFolder = workspaceOrFolder;

		// Launch Code...
		const code = await this.startApplication(extraArgs);

		// ...and make sure the window is ready to interact
		await measureAndLog(() => this.checkWindowReady(code), 'Application#checkWindowReady()', this.logger);
	}

	async stop(): Promise<void> {
		if (this._code) {
			try {
				await this._code.exit();
			} finally {
				this._code = undefined;
			}
		}
	}

	async startTracing(name: string): Promise<void> {
		await this._code?.startTracing(name);
	}

	async stopTracing(name: string, persist: boolean, customPath?: string): Promise<void> {
		await this._code?.stopTracing(name, persist, customPath);
	}

	// TODO: right place for this?
	async showContextMenu(trigger: () => void): Promise<{ menuId: number; items: MenuItem[] } | undefined> {
		const shownPromise: Promise<[number, MenuItem[]]> | undefined = _electronApp?.evaluate(({ app }) => {
			return new Promise((resolve) => {
				const listener: any = (...args: [number, MenuItem[]]) => {
					app.removeListener('e2e:contextMenuShown' as any, listener);
					resolve(args);
				};
				app.addListener('e2e:contextMenuShown' as any, listener);
			});
		});
		const [shownEvent] = await Promise.all([shownPromise, trigger()]);
		if (shownEvent) {
			const [menuId, items] = shownEvent;
			return {
				menuId,
				items
			};
		}

	}

	async selectContextMenuItem(contextMenuId: number, label: string): Promise<void> {
		await _electronApp?.evaluate(async ({ app }, [contextMenuId, label]) => {
			app.emit('e2e:contextMenuSelect', contextMenuId, label);
		}, [contextMenuId, label]);
	}

	private async startApplication(extraArgs: string[] = []): Promise<Code> {
		const code = this._code = await launch({
			...this.options,
			extraArgs: [...(this.options.extraArgs || []), ...extraArgs],
		});

		this._workbench = new Workbench(this._code);
		this._profiler = new Profiler(this.code);

		return code;
	}

	private async checkWindowReady(code: Code): Promise<void> {

		// We need a rendered workbench
		await measureAndLog(() => code.didFinishLoad(), 'Application#checkWindowReady: wait for navigation to be committed', this.logger);
		await measureAndLog(() => expect(code.driver.page.locator('.monaco-workbench')).toBeVisible({ timeout: 30000 }), 'Application#checkWindowReady: wait for .monaco-workbench element', this.logger);
		await measureAndLog(() => code.whenWorkbenchRestored(), 'Application#checkWorkbenchRestored', this.logger);

		// Remote but not web: wait for a remote connection state change
		if (this.remote) {
			await measureAndLog(() => expect(code.driver.page.locator('.monaco-workbench .statusbar-item[id="status.host"]')).not.toContainText('Opening Remote'), 'Application#checkWindowReady: wait for remote indicator', this.logger);
		}
	}
}
