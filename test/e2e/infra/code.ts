/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as os from 'os';
import treeKill from 'tree-kill';
import { ILogFile } from './driver';
import { Logger, measureAndLog } from './logger';
import { launch as launchPlaywrightBrowser } from './playwrightBrowser';
import { PlaywrightDriver } from './playwrightDriver';
import { launch as launchPlaywrightElectron } from './playwrightElectron';
import { teardown } from './processes';
import { Quality } from './application';

export interface LaunchOptions {
	codePath?: string;
	readonly workspacePath: string;
	userDataDir: string;
	readonly extensionsPath: string;
	readonly logger: Logger;
	logsPath: string;
	crashesPath: string;
	readonly verbose?: boolean;
	readonly extraArgs?: string[];
	readonly remote?: boolean;
	readonly web?: boolean;
	readonly tracing?: boolean;
	snapshots?: boolean;
	readonly headless?: boolean;
	readonly browser?: 'chromium' | 'webkit' | 'firefox';
	readonly quality: Quality;
}

interface ICodeInstance {
	kill: () => Promise<void>;
}

const instances = new Set<ICodeInstance>();

function registerInstance(process: cp.ChildProcess, logger: Logger, type: string) {
	const instance = { kill: () => teardown(process, logger) };
	instances.add(instance);

	process.stdout?.on('data', data => logger.log(`[${type}] stdout: ${data}`));
	process.stderr?.on('data', error => logger.log(`[${type}] stderr: ${error}`));

	process.once('exit', (code, signal) => {
		logger.log(`[${type}] Process terminated (pid: ${process.pid}, code: ${code}, signal: ${signal})`);

		instances.delete(instance);
	});
}

async function teardownAll(signal?: number) {
	stopped = true;

	for (const instance of instances) {
		await instance.kill();
	}

	if (typeof signal === 'number') {
		process.exit(signal);
	}
}

let stopped = false;
process.on('exit', () => teardownAll());
process.on('SIGINT', () => teardownAll(128 + 2)); 	 // https://nodejs.org/docs/v14.16.0/api/process.html#process_signal_events
process.on('SIGTERM', () => teardownAll(128 + 15)); // same as above

export async function launch(options: LaunchOptions): Promise<Code> {
	if (stopped) {
		throw new Error('Smoke test process has terminated, refusing to spawn Code');
	}

	// Browser smoke tests
	if (options.web) {
		const { serverProcess, driver } = await measureAndLog(() => launchPlaywrightBrowser(options), 'launch playwright (browser)', options.logger);
		registerInstance(serverProcess, options.logger, 'server');

		return new Code(driver, options.logger, serverProcess, options.quality);
	}

	// Electron smoke tests (playwright)
	else {
		const { electronProcess, driver } = await measureAndLog(() => launchPlaywrightElectron(options), 'launch playwright (electron)', options.logger);
		registerInstance(electronProcess, options.logger, 'electron');

		return new Code(driver, options.logger, electronProcess, options.quality);
	}
}

export class Code {

	readonly driver: PlaywrightDriver;

	constructor(
		driver: PlaywrightDriver,
		readonly logger: Logger,
		private readonly mainProcess: cp.ChildProcess,
		readonly quality: Quality
	) {
		this.driver = new Proxy(driver, {
			get(target, prop) {
				if (typeof prop === 'symbol') {
					throw new Error('Invalid usage');
				}

				const targetProp = (target as any)[prop];
				if (typeof targetProp !== 'function') {
					return targetProp;
				}

				return function (this: any, ...args: any[]) {
					logger.log(`${prop}`, ...args.filter(a => typeof a === 'string'));
					return targetProp.apply(this, args);
				};
			}
		});
	}

	async startTracing(name: string): Promise<void> {
		return await this.driver.startTracing(name);
	}

	async stopTracing(name: string, persist: boolean, customPath?: string): Promise<void> {
		return await this.driver.stopTracing(name, persist, customPath);
	}

	async didFinishLoad(): Promise<void> {
		return this.driver.didFinishLoad();
	}

	async exit(): Promise<void> {
		return measureAndLog(() => new Promise<void>(resolve => {
			const pid = this.mainProcess.pid!;

			let done = false;

			// Start the exit flow via driver
			this.driver.exitApplication();

			// Await the exit of the application
			(async () => {
				let retries = 0;
				while (!done) {
					retries++;

					switch (retries) {

						// after 5 / 10 seconds: try to exit gracefully again
						case 10:
						case 20: {
							this.logger.log('Smoke test exit call did not terminate process after 5-10s, gracefully trying to exit the application again...');
							this.driver.exitApplication();
							break;
						}

						// after 20 seconds: forcefully kill
						case 40: {
							this.logger.log('Smoke test exit call did not terminate process after 20s, forcefully exiting the application...');

							// no need to await since we're polling for the process to die anyways
							treeKill(pid, err => {
								try {
									process.kill(pid, 0); // throws an exception if the process doesn't exist anymore
									this.logger.log('Failed to kill Electron process tree:', err?.message);
								} catch (error) {
									// Expected when process is gone
								}
							});

							break;
						}

						// after 30 seconds: give up
						case 60: {
							done = true;
							this.logger.log('Smoke test exit call did not terminate process after 30s, giving up');
							resolve();
						}
					}

					try {
						process.kill(pid, 0); // throws an exception if the process doesn't exist anymore.
						await this.wait(500);
					} catch (error) {
						done = true;
						resolve();
					}
				}
			})();
		}), 'Code#exit()', this.logger);
	}

	async whenWorkbenchRestored(): Promise<void> {
		await this.poll(() => this.driver.whenWorkbenchRestored(), () => true, `when workbench restored`);
	}

	getLogs(): Promise<ILogFile[]> {
		return this.driver.getLogs();
	}

	wait(millis: number): Promise<void> {
		return this.driver.wait(millis);
	}

	private async poll<T>(
		fn: () => Promise<T>,
		acceptFn: (result: T) => boolean,
		timeoutMessage: string,
		retryCount = 200,
		retryInterval = 100 // millis
	): Promise<T> {
		let trial = 1;
		let lastError: string = '';

		while (true) {
			if (trial > retryCount) {
				this.logger.log('Timeout!');
				this.logger.log(lastError);
				this.logger.log(`Timeout: ${timeoutMessage} after ${(retryCount * retryInterval) / 1000} seconds.`);

				throw new Error(`Timeout: ${timeoutMessage} after ${(retryCount * retryInterval) / 1000} seconds.`);
			}

			let result;
			try {
				result = await fn();
				if (acceptFn(result)) {
					return result;
				} else {
					lastError = 'Did not pass accept function';
				}
			} catch (e: any) {
				lastError = Array.isArray(e.stack) ? e.stack.join(os.EOL) : e.stack;
			}

			await this.wait(retryInterval);
			trial++;
		}
	}
}
