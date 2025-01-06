/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as playwright from '@playwright/test';
// eslint-disable-next-line local/code-import-patterns
import type { Protocol } from 'playwright-core/types/protocol';
import { dirname, join } from 'path';
import { promises } from 'fs';
import { IWindowDriver } from './driver';
// eslint-disable-next-line local/code-import-patterns
import { PageFunction } from 'playwright-core/types/structs';
import { measureAndLog } from './logger';
import { LaunchOptions } from './code';
import { teardown } from './processes';
import { ChildProcess } from 'child_process';

export class PlaywrightDriver {

	private static traceCounter = 1;
	private static screenShotCounter = 1;


	// --- Start Positron ---
	// Removed declaration
	// --- End Positron ---

	constructor(
		private readonly application: playwright.Browser | playwright.ElectronApplication,
		// --- Start Positron --
		readonly context: playwright.BrowserContext,
		readonly page: playwright.Page,
		// --- End Positron ---
		private readonly serverProcess: ChildProcess | undefined,
		private readonly whenLoaded: Promise<unknown>,
		private readonly options: LaunchOptions
	) {
	}

	async startTracing(name: string): Promise<void> {
		if (!this.options.tracing) {
			return; // tracing disabled
		}

		try {
			await measureAndLog(() => this.context.tracing.startChunk({ title: name }), `startTracing for ${name}`, this.options.logger);
		} catch (error) {
			// Ignore
		}
	}

	// --- Start Positron ---
	async stopTracing(name: string, persist: boolean = true, customPath?: string): Promise<void> {
		// --- End Positron ---
		if (!this.options.tracing) {
			return; // tracing disabled
		}

		try {
			let persistPath: string | undefined = undefined;
			if (persist) {
				// --- Start Positron ---
				// Positron: Windows has issues with long paths, shortened the name
				persistPath = customPath || join(this.options.logsPath, `trace-${PlaywrightDriver.traceCounter++}-${name.replace(/\s+/g, '-')}.zip`);
				// --- End Positron ---
			}
			await measureAndLog(() => this.context.tracing.stopChunk({ path: persistPath }), `stopTracing for ${name}`, this.options.logger);
		} catch (error) {
			// Ignore
		}
	}

	async didFinishLoad(): Promise<void> {
		await this.whenLoaded;
	}

	private _cdpSession: playwright.CDPSession | undefined;

	async startCDP() {
		if (this._cdpSession) {
			return;
		}

		this._cdpSession = await this.page.context().newCDPSession(this.page);
	}

	async collectGarbage() {
		if (!this._cdpSession) {
			throw new Error('CDP not started');
		}

		await this._cdpSession.send('HeapProfiler.collectGarbage');
	}

	async evaluate(options: Protocol.Runtime.evaluateParameters): Promise<Protocol.Runtime.evaluateReturnValue> {
		if (!this._cdpSession) {
			throw new Error('CDP not started');
		}

		return await this._cdpSession.send('Runtime.evaluate', options);
	}

	async releaseObjectGroup(parameters: Protocol.Runtime.releaseObjectGroupParameters): Promise<void> {
		if (!this._cdpSession) {
			throw new Error('CDP not started');
		}

		await this._cdpSession.send('Runtime.releaseObjectGroup', parameters);
	}

	async queryObjects(parameters: Protocol.Runtime.queryObjectsParameters): Promise<Protocol.Runtime.queryObjectsReturnValue> {
		if (!this._cdpSession) {
			throw new Error('CDP not started');
		}

		return await this._cdpSession.send('Runtime.queryObjects', parameters);
	}

	async callFunctionOn(parameters: Protocol.Runtime.callFunctionOnParameters): Promise<Protocol.Runtime.callFunctionOnReturnValue> {
		if (!this._cdpSession) {
			throw new Error('CDP not started');
		}

		return await this._cdpSession.send('Runtime.callFunctionOn', parameters);
	}

	async takeHeapSnapshot(): Promise<string> {
		if (!this._cdpSession) {
			throw new Error('CDP not started');
		}

		let snapshot = '';
		const listener = (c: { chunk: string }) => {
			snapshot += c.chunk;
		};

		this._cdpSession.addListener('HeapProfiler.addHeapSnapshotChunk', listener);

		await this._cdpSession.send('HeapProfiler.takeHeapSnapshot');

		this._cdpSession.removeListener('HeapProfiler.addHeapSnapshotChunk', listener);
		return snapshot;
	}

	async getProperties(parameters: Protocol.Runtime.getPropertiesParameters): Promise<Protocol.Runtime.getPropertiesReturnValue> {
		if (!this._cdpSession) {
			throw new Error('CDP not started');
		}

		return await this._cdpSession.send('Runtime.getProperties', parameters);
	}

	// --- Start Positron ---
	// Positron: make this method public for access from R/Python fixtures
	async takeScreenshot(name: string): Promise<void> {
		try {
			// Positron: Windows has issues with long paths, shortened the name
			const persistPath = join(this.options.logsPath, `screenshot-${PlaywrightDriver.screenShotCounter++}-${name.replace(/\s+/g, '-')}.png`);
			// --- End Positron ---

			await measureAndLog(() => this.page.screenshot({ path: persistPath, type: 'png' }), 'takeScreenshot', this.options.logger);
		} catch (error) {
			// Ignore
		}
	}

	async reload() {
		await this.page.reload();
	}

	async exitApplication() {

		// Stop tracing
		try {
			if (this.options.tracing) {
				await measureAndLog(() => this.context.tracing.stop(), 'stop tracing', this.options.logger);
			}
		} catch (error) {
			// Ignore
		}

		// Web: Extract client logs
		if (this.options.web) {
			try {
				await measureAndLog(() => this.saveWebClientLogs(), 'saveWebClientLogs()', this.options.logger);
			} catch (error) {
				this.options.logger.log(`Error saving web client logs (${error})`);
			}
		}

		// Web: exit via `close` method
		if (this.options.web) {
			try {
				await measureAndLog(() => this.application.close(), 'playwright.close()', this.options.logger);
			} catch (error) {
				this.options.logger.log(`Error closing appliction (${error})`);
			}
		}

		// Desktop: exit via `driver.exitApplication`
		else {
			try {
				await measureAndLog(() => this.evaluateWithDriver(([driver]) => driver.exitApplication()), 'driver.exitApplication()', this.options.logger);
			} catch (error) {
				this.options.logger.log(`Error exiting appliction (${error})`);
			}
		}

		// Server: via `teardown`
		if (this.serverProcess) {
			await measureAndLog(() => teardown(this.serverProcess!, this.options.logger), 'teardown server process', this.options.logger);
		}
	}

	private async saveWebClientLogs(): Promise<void> {
		const logs = await this.getLogs();

		for (const log of logs) {
			const absoluteLogsPath = join(this.options.logsPath, log.relativePath);

			await promises.mkdir(dirname(absoluteLogsPath), { recursive: true });
			await promises.writeFile(absoluteLogsPath, log.contents);
		}
	}

	// --- Start Positron ---
	// Removed functions
	// --- End Positron ---

	async getLogs() {
		return this.page.evaluate(([driver]) => driver.getLogs(), [await this.getDriverHandle()] as const);
	}

	private async evaluateWithDriver<T>(pageFunction: PageFunction<IWindowDriver[], T>) {
		return this.page.evaluate(pageFunction, [await this.getDriverHandle()]);
	}

	wait(ms: number): Promise<void> {
		return new Promise<void>(resolve => setTimeout(resolve, ms));
	}

	whenWorkbenchRestored(): Promise<void> {
		return this.evaluateWithDriver(([driver]) => driver.whenWorkbenchRestored());
	}

	private async getDriverHandle(): Promise<playwright.JSHandle<IWindowDriver>> {
		return this.page.evaluateHandle('window.driver');
	}

	// --- Start Positron ---
	async typeKeys(locator: string, text: string): Promise<void> {
		return this.page.locator(locator).pressSequentially(text);
	}

	getLocator(selector: string): playwright.Locator {
		return this.page.locator(selector);
	}

	getKeyboard() {
		return this.page.keyboard;
	}

	getFrame(frameSelector: string): playwright.FrameLocator {
		return this.page.frameLocator(frameSelector);
	}

	/**
	 * Set the size of the browser window for more predicable test results.
	 * @param opts.width Width in pixels
	 * @param opts.height Height in pixels
	 */
	async setViewportSize(opts: { width: number; height: number }) {
		await this.page.setViewportSize(opts);
	}

	/**
	 * Click and drag from one point to another.
	 * @param opts.from The starting point of the drag as x-y coordinates
	 * @param opts.to The ending point of the drag as x-y coordinates
	 * @param opts.delta The change in x-y coordinates from the starting point
	 */
	async clickAndDrag(opts: { from: { x: number; y: number }; to: { x: number; y: number } }): Promise<void>;
	async clickAndDrag(opts: { from: { x: number; y: number }; delta: { x?: number; y?: number } }): Promise<void>;
	async clickAndDrag(opts: { from: { x: number; y: number }; to?: { x: number; y: number }; delta?: { x?: number; y?: number } }): Promise<void> {
		const from = opts.from;
		const to = opts.to ?? { x: from.x + (opts.delta?.x ?? 0), y: from.y + (opts.delta?.y ?? 0) };
		await this.page.mouse.move(from.x, from.y);
		await this.page.mouse.down();
		await this.page.mouse.move(to.x, to.y);
		await this.page.mouse.up();
	}

	// --- End Positron ---
}
