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

const READINESS_LOCATORS = {
	monacoWorkbench: '.monaco-workbench',
	explorerFoldersView: '.explorer-folders-view',
	activityBar: '.activitybar',
	statusBar: '.statusbar',
	remoteHost: '.monaco-workbench .statusbar-item[id="status.host"]',
	positWorkbenchSignIn: 'Sign in to Posit Workbench'
} as const;

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
	const isWorkbench = options.useExternalServer && options.externalServerUrl?.includes(':8787');
	return isWorkbench ? new PositWorkbench(code) : new Workbench(code);
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
	 */
	get positWorkbench(): PositWorkbench {
		if (this._workbench instanceof PositWorkbench) {
			return this._workbench;
		}
		throw new Error('positWorkbench is only available in e2e-workbench contexts');
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
		const isWorkbench = this.options.useExternalServer && this.options.externalServerUrl?.includes(':8787');
		const isPositronServer = this.options.useExternalServer && this.options.externalServerUrl?.includes(':8080');

		// We need a rendered workbench
		await measureAndLog(() => code.didFinishLoad(), 'Application#checkWindowReady: wait for navigation to be committed', this.logger);

		// Readiness checks differ based on the type of connection
		if (isWorkbench) {
			await measureAndLog(() => this.checkPositWorkbenchReady(code), 'Application#checkPositWorkbenchReady', this.logger);
		} else if (isPositronServer) {
			await measureAndLog(() => this.checkPositronServerReady(code), 'Application#checkPositronServerReady', this.logger);
		} else {
			await measureAndLog(() => this.checkPositronReady(code), 'Application#checkPositronReady', this.logger);
		}

		// Remote but not web: wait for a remote connection state change
		if (this.remote) {
			await measureAndLog(
				() => expect(code.driver.page.locator(READINESS_LOCATORS.remoteHost)).not.toContainText('Opening Remote'),
				'Application#checkWindowReady: wait for remote indicator',
				this.logger
			);
		}
	}

	/**
	 * Positron readiness checks
	 */
	private async checkPositronReady(code: Code): Promise<void> {
		await measureAndLog(
			() => expect(code.driver.page.locator(READINESS_LOCATORS.monacoWorkbench)).toBeVisible({ timeout: 30000 }),
			'Application#checkPositronReady: wait for monaco workbench',
			this.logger
		);
		await measureAndLog(() => code.whenWorkbenchRestored(), 'Application#checkPositronReady: wait for workbench restored', this.logger);
		await measureAndLog(
			() => expect(code.driver.page.locator(READINESS_LOCATORS.explorerFoldersView)).toBeVisible({ timeout: 60000 }),
			'Application#checkPositronReady: wait for explorer view',
			this.logger
		);
	}

	/**
	 * Posit Workbench readiness checks
	 */
	private async checkPositWorkbenchReady(code: Code): Promise<void> {
		await measureAndLog(
			() => expect(code.driver.page.getByText(READINESS_LOCATORS.positWorkbenchSignIn)).toBeVisible({ timeout: 30000 }),
			'Application#checkPositWorkbenchReady: wait for sign in prompt',
			this.logger
		);
	}

	/**
	 * External Positron Server readiness checks
	 */
	private async checkPositronServerReady(code: Code): Promise<void> {
		await measureAndLog(
			() => expect(code.driver.page.locator(READINESS_LOCATORS.monacoWorkbench)).toBeVisible({ timeout: 30000 }),
			'Application#checkPositronServerReady: wait for monaco workbench',
			this.logger
		);
		await measureAndLog(
			() => expect(code.driver.page.locator(READINESS_LOCATORS.explorerFoldersView)).toBeVisible({ timeout: 60000 }),
			'Application#checkPositronServerReady: wait for explorer view',
			this.logger
		);
		await measureAndLog(
			() => expect(code.driver.page.locator(READINESS_LOCATORS.activityBar)).toBeVisible({ timeout: 30000 }),
			'Application#checkPositronServerReady: wait for activity bar',
			this.logger
		);
		await measureAndLog(
			() => expect(code.driver.page.locator(READINESS_LOCATORS.statusBar)).toBeVisible({ timeout: 30000 }),
			'Application#checkPositronServerReady: wait for status bar',
			this.logger
		);
	}
}
