/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Workbench } from './workbench';
import { Code, launch, LaunchOptions } from './code';
import { Logger, measureAndLog } from './logger';
import { Profiler } from './profiler';

// --- Start Positron ---
import { expect } from '@playwright/test';
// --- End Positron ---

export const enum Quality {
	Dev,
	Insiders,
	Stable,
	Exploration,
	OSS
}

export interface ApplicationOptions extends LaunchOptions {
	quality: Quality;
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

	get extensionsPath(): string | undefined {
		return this.options.extensionsPath;
	}

	private _userDataPath: string | undefined;
	get userDataPath(): string | undefined {
		return this._userDataPath;
	}

	private _profiler: Profiler | undefined;

	get profiler(): Profiler { return this._profiler!; }

	async start(): Promise<void> {
		await this._start();
		// --- Start Positron ---
		await expect(this.code.driver.page.locator('.explorer-folders-view')).toBeVisible();
		// --- End Positron ---
	}

	// --- Start Positron ---
	async connectToExternalServer(): Promise<void> {
		await this._connectToExternalServer();
		await expect(this.code.driver.page.locator('.explorer-folders-view')).toBeVisible();
	}
	// --- End Positron ---

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

	// --- Start Positron ---
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

		this._workbench = new Workbench(this._code);
		this._profiler = new Profiler(this.code);

		return code;
	}
	// --- End Positron ---

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

		this._workbench = new Workbench(this._code);
		this._profiler = new Profiler(this.code);

		return code;
	}

	private async checkWindowReady(code: Code): Promise<void> {

		// We need a rendered workbench
		await measureAndLog(() => code.didFinishLoad(), 'Application#checkWindowReady: wait for navigation to be committed', this.logger);
		await measureAndLog(() => expect(code.driver.page.locator('.monaco-workbench')).toBeVisible({ timeout: 30000 }), 'Application#checkWindowReady: wait for .monaco-workbench element', this.logger);

		// --- Start Positron ---
		// For external servers, use a more robust readiness check
		/*
		await measureAndLog(() => code.whenWorkbenchRestored(), 'Application#checkWorkbenchRestored', this.logger);
		*/
		if (this.options.useExternalServer) {
			await measureAndLog(() => this.checkExternalServerWorkbenchReady(code), 'Application#checkExternalServerWorkbenchReady', this.logger);
		} else {
			await measureAndLog(() => code.whenWorkbenchRestored(), 'Application#checkWorkbenchRestored', this.logger);
		}
		// --- End Positron ---

		// Remote but not web: wait for a remote connection state change
		if (this.remote) {
			// --- Start Positron ---
			/*
			await measureAndLog(() => code.waitForTextContent('.monaco-workbench .statusbar-item[id="status.host"]', undefined, statusHostLabel => {
				this.logger.log(`checkWindowReady: remote indicator text is ${statusHostLabel}`);

				// The absence of "Opening Remote" is not a strict
				// indicator for a successful connection, but we
				// want to avoid hanging here until timeout because
				// this method is potentially called from a location
				// that has no tracing enabled making it hard to
				// diagnose this. As such, as soon as the connection
				// state changes away from the "Opening Remote..." one
				// we return.
				return !statusHostLabel.includes('Opening Remote');
			}, 300 /* = 30s of retry */), 'Application#checkWindowReady: wait for remote indicator', this.logger);
			*/
			await measureAndLog(() => expect(code.driver.page.locator('.monaco-workbench .statusbar-item[id="status.host"]')).not.toContainText('Opening Remote'), 'Application#checkWindowReady: wait for remote indicator', this.logger);
			// --- End Positron ---
		}
	}

	private async checkExternalServerWorkbenchReady(code: Code): Promise<void> {
		// For external servers, check for key UI elements that indicate readiness
		// instead of relying on lifecycle phases which may have already completed
		// await code.driver.page.getByRole('button', { name: 'Yes, I trust the authors' }).click();

		// Wait for the explorer to be visible (main workbench element)
		await expect(code.driver.page.locator('.explorer-folders-view')).toBeVisible({ timeout: 60000 });

		// Wait for the activity bar to be ready
		await expect(code.driver.page.locator('.activitybar')).toBeVisible({ timeout: 30000 });

		// Wait for the status bar to be ready
		await expect(code.driver.page.locator('.statusbar')).toBeVisible({ timeout: 30000 });
	}
}
