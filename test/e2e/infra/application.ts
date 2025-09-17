/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Workbench } from './workbench';
import { Code, launch, LaunchOptions } from './code';
import { Logger, measureAndLog } from './logger';
import { Profiler } from './profiler';
import { expect } from '@playwright/test';
import { PositWorkbench } from './workbench-pwb.js';

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

/**
 * Creates the appropriate workbench instance based on external server configuration
 */
function createWorkbench(code: Code, options: ApplicationOptions): Workbench {
	// If external server URL contains :8787, it's Posit Workbench
	if (options.useExternalServer && options.externalServerUrl?.includes(':8787')) {
		return new PositWorkbench(code);
	}
	return new Workbench(code);
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

	/**
	 * Get the Posit Workbench instance. Only available in e2e-workbench contexts.
	 * Use this when you know you're in a workbench context for cleaner type-safe code.
	 */
	get positWorkbench(): PositWorkbench {
		if (this._workbench instanceof PositWorkbench) {
			return this._workbench;
		}
		throw new Error('positWorkbench is only available in e2e-workbench contexts');
	}

	/**
	 * Type guard to check if this application has PositWorkbench functionality
	 */
	hasPositWorkbench(): this is Application & { positWorkbench: PositWorkbench } {
		return this._workbench instanceof PositWorkbench;
	}

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
	}

	async connectToExternalServer(): Promise<void> {
		await this._connectToExternalServer();
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

	async stopExternalServer(): Promise<void> {
		// For external servers, we only need to close the browser connection
		// The external server keeps running
		if (this._code) {
			try {
				await this._code.driver.close();
			} finally {
				this._code = undefined;
			}
		}
	}

	private async _connectToExternalServer(): Promise<void> {
		// Connect to external server without launching
		const code = await this.connectToExternalApplication();

		// Make sure the window is ready to interact
		await measureAndLog(() => this.checkWindowReady(code), 'Application#checkWindowReady() [external]', this.logger);
	}

	private async connectToExternalApplication(): Promise<Code> {
		const code = this._code = await launch({
			...this.options,
		});

		this._workbench = createWorkbench(this._code, this.options);
		this._profiler = new Profiler(this.code);

		return code;
	}

	async startTracing(name: string): Promise<void> {
		await this._code?.startTracing(name);
	}

	async stopTracing(name: string, persist: boolean, customPath?: string): Promise<void> {
		await this._code?.stopTracing(name, persist, customPath);
	}

	private async startApplication(extraArgs: string[] = []): Promise<Code> {
		const code = this._code = await launch({
			...this.options,
			extraArgs: [...(this.options.extraArgs || []), ...extraArgs],
		});

		this._workbench = createWorkbench(this._code, this.options);
		this._profiler = new Profiler(this.code);

		return code;
	}

	private async checkWindowReady(code: Code): Promise<void> {
		// We need a rendered workbench
		await measureAndLog(() => code.didFinishLoad(), 'Application#checkWindowReady: wait for navigation to be committed', this.logger);

		// For external servers, use specialized readiness checks
		if (this.options.useExternalServer) {
			await measureAndLog(() => this.checkExternalServerWorkbenchReady(code), 'Application#checkExternalServerWorkbenchReady', this.logger);
		} else {
			// Standard VS Code workbench checks
			await measureAndLog(() => expect(code.driver.page.locator('.monaco-workbench')).toBeVisible({ timeout: 30000 }), 'Application#checkWindowReady: wait for .monaco-workbench element', this.logger);
			await measureAndLog(() => code.whenWorkbenchRestored(), 'Application#checkWorkbenchRestored', this.logger);

			// Wait for the explorer to be visible
			await measureAndLog(() => expect(code.driver.page.locator('.explorer-folders-view')).toBeVisible({ timeout: 60000 }), 'Application#checkWindowReady: wait for .explorer-folders-view element', this.logger);
		}

		// Remote but not web: wait for a remote connection state change
		if (this.remote) {
			await measureAndLog(() => expect(code.driver.page.locator('.monaco-workbench .statusbar-item[id="status.host"]')).not.toContainText('Opening Remote'), 'Application#checkWindowReady: wait for remote indicator', this.logger);
		}
	}

	private async checkExternalServerWorkbenchReady(code: Code): Promise<void> {
		const serverType = this.getExternalServerType();

		switch (serverType) {
			case 'posit-workbench':
				await this.checkPositWorkbenchReady(code);
				break;
			case 'vscode-server':
			default:
				await this.checkVSCodeServerReady(code);
				break;
		}
	}

	private getExternalServerType(): 'posit-workbench' | 'vscode-server' {
		if (this.options.externalServerUrl?.includes(':8787')) {
			return 'posit-workbench';
		}
		return 'vscode-server';
	}

	private async checkPositWorkbenchReady(code: Code): Promise<void> {
		// For Posit Workbench, we expect to see a login screen
		await expect(code.driver.page.getByText('Sign in to Posit Workbench')).toBeVisible({ timeout: 30000 });
	}

	private async checkVSCodeServerReady(code: Code): Promise<void> {
		// Standard VS Code server readiness checks

		// Wait for the monaco workbench to be visible
		await expect(code.driver.page.locator('.monaco-workbench')).toBeVisible({ timeout: 30000 });

		// Wait for the explorer to be visible (main workbench element)
		await expect(code.driver.page.locator('.explorer-folders-view')).toBeVisible({ timeout: 60000 });

		// Wait for the activity bar to be ready
		await expect(code.driver.page.locator('.activitybar')).toBeVisible({ timeout: 30000 });

		// Wait for the status bar to be ready
		await expect(code.driver.page.locator('.statusbar')).toBeVisible({ timeout: 30000 });
	}
}
