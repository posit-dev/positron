/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// This module must not import `vscode`, directly or through another module, so
// that it can be unit tested with Vitest. `api.ts` supplies the parts that need
// the extension API through `AppController` and `Closable`.

import { raceTimeout } from './utils';

/**
 * Where an app is in its life:
 * - `starting`: its process is running and Positron is watching its output
 *   for its URL.
 * - `running`: its process is running. Its URL is known unless Positron
 *   stopped watching for it (detection timed out, or previewing is off).
 * - `exited`: its process ended, whether it was stopped or it crashed.
 * - `unknown`: it was started without shell integration, so Positron cannot
 *   see whether its process is still running.
 */
export type AppStatus = 'starting' | 'running' | 'exited' | 'unknown';

/** Where an app's process runs. */
export type AppHost = 'terminal' | 'console';

/** Facts about an app that are fixed when it starts. */
export interface AppInfo {
	/** The app file's URI, as a string. */
	readonly file: string;
	/** The app's framework, such as `Streamlit`. Positron runs one app per name. */
	readonly name: string;
	readonly runsIn: AppHost;
	/** Where the app is previewed once its URL is found. */
	readonly preview: string;
	/** The console session the app runs in, for apps that run in a console. */
	readonly sessionId?: string;
}

/** What an agent is told about an app. Plain JSON. */
export interface AppSummary extends AppInfo {
	readonly status: AppStatus;
	/** Where the user opens the app. On Posit Workbench this is the proxied URL. */
	readonly url?: string;
	/** Where the app serves from inside the session, such as for `curl`. */
	readonly localUrl?: string;
	/** The exit code of a terminal app's process, once it has exited. */
	readonly exitCode?: number;
}

/** The result of asking to stop an app. Plain JSON. */
export type StopAppResult =
	| {
		readonly stopped: true;
		readonly file: string;
		readonly name: string;
		/** `interrupted` for Ctrl+C or a console interrupt; `terminated` when its terminal was closed. */
		readonly method: 'interrupted' | 'terminated';
	}
	| {
		readonly stopped: false;
		readonly reason: 'not-found' | 'not-running' | 'did-not-stop';
		readonly message: string;
	};

/** Stops an app's process, the way that suits where it runs. */
export interface AppController {
	/** Ask the app to stop, as pressing Ctrl+C does. */
	interrupt(): Promise<void>;
	/** Stop the app forcibly. Absent when there is no forcible way. */
	terminate?(): Promise<void>;
}

/** Something to close once the app is stopped, such as its preview. */
export interface Closable {
	dispose(): void;
}

/** One app that Positron ran, and what is known about it now. */
export class RunningApp {
	private _status: AppStatus;
	private _url: string | undefined;
	private _localUrl: string | undefined;
	private _exitCode: number | undefined;
	private _preview: Closable | undefined;
	private _resolveExited!: () => void;
	private readonly _exited = new Promise<void>(resolve => { this._resolveExited = resolve; });

	constructor(
		readonly info: AppInfo,
		private readonly _controller: AppController,
		status: Exclude<AppStatus, 'exited'>,
	) {
		this._status = status;
	}

	get status(): AppStatus {
		return this._status;
	}

	/** Record the app's URLs once Positron has found them. */
	foundUrl(localUrl: string, url: string): void {
		this._localUrl = localUrl;
		this._url = url;
		if (this._status === 'starting') {
			this._status = 'running';
		}
	}

	/** Positron stopped watching for the app's URL without finding it. */
	stoppedWatchingForUrl(): void {
		if (this._status === 'starting') {
			this._status = 'running';
		}
	}

	/** Record the preview showing the app, so stopping the app can close it. */
	setPreview(preview: Closable | undefined): void {
		this._preview = preview;
	}

	/** The app's process ended. */
	exited(exitCode?: number): void {
		if (this._status === 'exited') {
			return;
		}
		this._status = 'exited';
		this._exitCode = exitCode;
		this._resolveExited();
	}

	/**
	 * Stop the app: interrupt it, and if it is still running after `timeout`
	 * ms, terminate it. Closes its preview once it has stopped.
	 */
	async stop(timeout: number): Promise<StopAppResult> {
		const { file, name } = this.info;
		if (this._status === 'exited') {
			return { stopped: false, reason: 'not-running', message: `The ${name} app has already exited.` };
		}

		// With no view of the process, Positron cannot tell whether an interrupt
		// worked, so go straight to terminating it.
		if (this._status !== 'unknown') {
			await this._controller.interrupt();
			if (await this._waitForExit(timeout)) {
				this._closePreview();
				return { stopped: true, file, name, method: 'interrupted' };
			}
		}

		if (this._controller.terminate) {
			await this._controller.terminate();
			if (await this._waitForExit(timeout)) {
				this._closePreview();
				return { stopped: true, file, name, method: 'terminated' };
			}
		}

		return {
			stopped: false,
			reason: 'did-not-stop',
			message: `The ${name} app was still running ${timeout / 1000} seconds after it was asked to stop.`,
		};
	}

	toSummary(): AppSummary {
		return {
			...this.info,
			status: this._status,
			url: this._url,
			localUrl: this._localUrl,
			exitCode: this._exitCode,
		};
	}

	private async _waitForExit(timeout: number): Promise<boolean> {
		return await raceTimeout(this._exited.then(() => true), timeout) ?? false;
	}

	private _closePreview(): void {
		this._preview?.dispose();
		this._preview = undefined;
	}
}

/**
 * The apps Positron has run in this window, so an agent can find out what is
 * running and where, and stop it.
 */
export class AppRegistry {
	private readonly _appsByName = new Map<string, RunningApp>();

	/**
	 * Track a newly started app. It replaces any app run earlier under the same
	 * name: Positron closes that one before starting a new one.
	 */
	add(app: RunningApp): void {
		this._appsByName.set(app.info.name, app);
	}

	list(): AppSummary[] {
		return [...this._appsByName.values()].map(app => app.toSummary());
	}

	/** Stop the app run from `file`, preferring one that is still running. */
	async stop(file: string, timeout: number): Promise<StopAppResult> {
		const apps = [...this._appsByName.values()].filter(app => app.info.file === file);
		const app = apps.find(app => app.status !== 'exited') ?? apps[0];
		if (!app) {
			return {
				stopped: false,
				reason: 'not-found',
				message: `Positron has no record of running an app from ${file}.`,
			};
		}
		return app.stop(timeout);
	}
}
