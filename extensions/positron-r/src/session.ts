/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import PQueue from 'p-queue';

import { PositronSupervisorApi, JupyterKernelSpec, JupyterLanguageRuntimeSession, JupyterKernelExtra } from './positron-supervisor';
import { ArkLsp, LspState } from './lsp';
import { delay, whenTimeout, timeout } from './util';
import { ArkAttachOnStartup, ArkDelayStartup } from './startup';
import { RHtmlWidget, getResourceRoots } from './htmlwidgets';
import { randomUUID } from 'crypto';
import { handleRCode } from './hyperlink';
import { RSessionManager } from './session-manager';
import { LOGGER } from './extension.js';

interface RPackageInstallation {
	packageName: string;
	packageVersion: string;
	minimumVersion: string;
	compatible: boolean;
}

export interface EnvVar {
	[key: string]: string;
}

// At the time of writing, we only use LANG, but we expect other aspects of the active R session's
// locale to also be present here, such as LC_CTYPE or LC_TIME. These can vary by OS, so this
// interface doesn't attempt to enumerate them.
interface Locale {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	LANG: string;
	[key: string]: string;
}

/**
 * A Positron language runtime that wraps a Jupyter kernel and a Language Server
 * Protocol client.
 */
export class RSession implements positron.LanguageRuntimeSession, vscode.Disposable {

	/** The Language Server Protocol client wrapper */
	private _lsp: ArkLsp;

	/** Queue for LSP events */
	private _lspQueue: PQueue;

	/**
	 * Promise that resolves after LSP server activation is finished.
	 * Tracked to avoid stopping in the middle of startup.
	 * Resolves to the port number the client should connect on.
	 */
	private _lspStartingPromise: Promise<number> = Promise.resolve(0);

	/** Client ID for the LSP, used to close the Jupyter comm during deactivation */
	private _lspClientId?: string;

	/** The Jupyter kernel-based session implementing the Language Runtime API */
	private _kernel?: JupyterLanguageRuntimeSession;

	/** The emitter for language runtime messages */
	private _messageEmitter =
		new vscode.EventEmitter<positron.LanguageRuntimeMessage>();

	/** The emitter for language runtime state changes */
	private _stateEmitter =
		new vscode.EventEmitter<positron.RuntimeState>();

	/** The emitter for runtime exits */
	private _exitEmitter =
		new vscode.EventEmitter<positron.LanguageRuntimeExit>();

	/** The Positron Supervisor extension API */
	private adapterApi?: PositronSupervisorApi;

	/** The registration for console width changes */
	private _consoleWidthDisposable?: vscode.Disposable;

	/** The current state of the runtime */
	private _state: positron.RuntimeState = positron.RuntimeState.Uninitialized;

	/** A timestamp assigned when the session was created. */
	private _created: number;

	/** Cache of installed packages and associated version info */
	private _packageCache: Map<string, RPackageInstallation> = new Map();

	/** The current dynamic runtime state */
	public dynState: positron.LanguageRuntimeDynState;

	constructor(
		readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
		readonly metadata: positron.RuntimeSessionMetadata,
		readonly kernelSpec?: JupyterKernelSpec,
		readonly extra?: JupyterKernelExtra,
		sessionName?: string,
	) {
		// Set the initial dynamic state
		this.dynState = {
			sessionName: sessionName || runtimeMetadata.runtimeName,
			continuationPrompt: '+',
			inputPrompt: '>',
		};

		this._lsp = new ArkLsp(runtimeMetadata.languageVersion, metadata, this.dynState);
		this._lspQueue = new PQueue({ concurrency: 1 });
		this.onDidReceiveRuntimeMessage = this._messageEmitter.event;
		this.onDidChangeRuntimeState = this._stateEmitter.event;
		this.onDidEndSession = this._exitEmitter.event;

		// Timestamp the session creation
		this._created = Date.now();

		// Register this session with the session manager
		RSessionManager.instance.setSession(metadata.sessionId, this);

		this.onDidChangeRuntimeState(async (state) => {
			await this.onStateChange(state);
		});
	}

	onDidEndSession: vscode.Event<positron.LanguageRuntimeExit>;
	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>;
	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>;

	/**
	 * Accessor for the current state of the runtime.
	 */
	get state(): positron.RuntimeState {
		return this._state;
	}

	/**
	 * Accessor for the creation time of the runtime.
	 */
	get created(): number {
		return this._created;
	}

	/**
	 * Information about the runtime that is only available after starting
	 */
	get runtimeInfo(): positron.LanguageRuntimeInfo | undefined {
		return this._kernel?.runtimeInfo;
	}

	/**
	 * Opens a resource in the runtime.
	 * @param resource The resource to open.
	 * @returns true if the resource was opened; otherwise, false.
	 */
	openResource(resource: vscode.Uri | string): Thenable<boolean> {
		// If the resource is a string, parse it as a URI.
		if (typeof resource === 'string') {
			resource = vscode.Uri.parse(resource);
		}

		// Dispatch the open.
		switch (resource.scheme) {
			// Open help resource.
			case 'x-r-help':
				this.showHelpTopic(resource.path);
				return Promise.resolve(true);

			// Open vignette resource.
			case 'x-r-vignette':
				this.showVignetteTopic(resource.path);
				return Promise.resolve(true);

			// Run code.
			case 'x-r-run':
				handleRCode(this, resource.path);
				return Promise.resolve(true);

			// Unhandled.
			default:
				return Promise.resolve(false);
		}
	}

	async debug(request: positron.DebugProtocolRequest): Promise<positron.DebugProtocolResponse> {
		throw new Error(`Debugging is not supported in R sessions`);
	}

	execute(code: string, id: string, mode: positron.RuntimeCodeExecutionMode, errorBehavior: positron.RuntimeErrorBehavior): void {
		if (this._kernel) {
			this._kernel.execute(code, id, mode, errorBehavior);
		} else {
			throw new Error(`Cannot execute '${code}'; kernel not started`);
		}
	}

	callMethod(method: string, ...args: any[]): Thenable<any> {
		if (this._kernel) {
			return this._kernel.callMethod(method, ...args);
		} else {
			throw new Error(`Cannot call method '${method}'; kernel not started`);
		}
	}

	isCodeFragmentComplete(code: string): Thenable<positron.RuntimeCodeFragmentStatus> {
		if (this._kernel) {
			return this._kernel.isCodeFragmentComplete(code);
		} else {
			throw new Error(`Cannot check code fragment '${code}'; kernel not started`);
		}
	}

	createClient(id: string, type: positron.RuntimeClientType, params: any, metadata?: any): Thenable<void> {
		if (this._kernel) {
			return this._kernel.createClient(id, type, params, metadata);
		} else {
			throw new Error(`Cannot create client of type '${type}'; kernel not started`);
		}
	}

	listClients(type?: positron.RuntimeClientType | undefined): Thenable<Record<string, string>> {
		if (this._kernel) {
			return this._kernel.listClients(type);
		} else {
			throw new Error(`Cannot list clients; kernel not started`);
		}
	}

	removeClient(id: string): void {
		if (this._kernel) {
			this._kernel.removeClient(id);
		} else {
			throw new Error(`Cannot remove client ${id}; kernel not started`);
		}
	}

	sendClientMessage(clientId: string, messageId: string, message: any): void {
		if (this._kernel) {
			this._kernel.sendClientMessage(clientId, messageId, message);
		} else {
			throw new Error(`Cannot send message to client ${clientId}; kernel not started`);
		}
	}

	replyToPrompt(id: string, reply: string): void {
		if (this._kernel) {
			this._kernel.replyToPrompt(id, reply);
		} else {
			throw new Error(`Cannot reply to prompt ${id}; kernel not started`);
		}
	}

	/**
	 * Sets the working directory for the runtime.
	 *
	 * @param dir The working directory to set.
	 */
	async setWorkingDirectory(dir: string): Promise<void> {
		if (this._kernel) {
			// Escape any backslashes in the directory path
			dir = dir.replace(/\\/g, '\\\\');

			// Escape any quotes in the directory path
			dir = dir.replace(/"/g, '\\"');

			// Tell the kernel to change the working directory
			this._kernel.execute(`setwd("${dir}")`,
				randomUUID(),
				positron.RuntimeCodeExecutionMode.Interactive,
				positron.RuntimeErrorBehavior.Continue);
		} else {
			throw new Error(`Cannot change to ${dir}; kernel not started`);
		}
	}

	async start(): Promise<positron.LanguageRuntimeInfo> {
		if (!this._kernel) {
			this._kernel = await this.createKernel();
		}
		RSessionManager.instance.setLastBinpath(this._kernel.runtimeMetadata.runtimePath);

		// Register for console width changes, if we haven't already
		if (!this._consoleWidthDisposable) {
			this._consoleWidthDisposable =
				positron.window.onDidChangeConsoleWidth((newWidth) => {
					this.onConsoleWidthChange(newWidth);
				});
		}
		return this._kernel.start();
	}

	private async onConsoleWidthChange(newWidth: number): Promise<void> {
		// Ignore if no kernel
		if (!this._kernel) {
			return;
		}

		// Ignore if kernel exited
		if (this._state === positron.RuntimeState.Exited) {
			return;
		}

		try {
			// Send the new width to R; this returns the old width for logging
			const oldWidth = await this.callMethod('setConsoleWidth', newWidth);
			this._kernel!.emitJupyterLog(`Set console width from ${oldWidth} to ${newWidth}`);
		} catch (err) {
			// Log the error if we can't set the console width; this is not
			// fatal, so we don't rethrow the error
			const runtimeError = err as positron.RuntimeMethodError;
			this._kernel!.emitJupyterLog(
				`Error setting console width: ${runtimeError.message} ${runtimeError.code})`,
				vscode.LogLevel.Error);
		}
	}

	async interrupt(): Promise<void> {
		if (this._kernel) {
			return this._kernel.interrupt();
		} else {
			throw new Error('Cannot interrupt; kernel not started');
		}
	}

	async restart(workingDirectory: string | undefined): Promise<void> {
		if (this._kernel) {
			this._kernel.emitJupyterLog('Restarting');
			// Stop the LSP client before restarting the kernel. Don't stop it
			// until fully started to avoid an inconsistent state where the
			// deactivation request comes in between the creation of the LSP
			// comm and the LSP client.
			//
			// A cleaner way to set this up might be to put `this._lsp` in
			// charge of creating the LSP comm, then `deactivate()` could
			// keep track of this state itself.
			const timedOut = await Promise.race([
				// No need to log LSP start failures here; they're logged on activation.
				this._lspStartingPromise.catch(() => { }),
				whenTimeout(400, () => true),
			]);
			if (timedOut) {
				this._kernel.emitJupyterLog(
					'LSP startup timed out during interpreter restart',
					vscode.LogLevel.Warning,
				);
			}
			await this.deactivateLsp('restarting session');
			return this._kernel.restart(workingDirectory);
		} else {
			throw new Error('Cannot restart; kernel not started');
		}
	}

	async shutdown(exitReason = positron.RuntimeExitReason.Shutdown): Promise<void> {
		if (this._kernel) {
			this._kernel.emitJupyterLog('Shutting down');
			// Stop the LSP client before shutting down the kernel
			await this.deactivateLsp('shutting down session');
			return this._kernel.shutdown(exitReason);
		} else {
			throw new Error('Cannot shutdown; kernel not started');
		}
	}

	async forceQuit(): Promise<void> {
		if (this._kernel) {
			this._kernel.emitJupyterLog('Force quitting');
			// Stop the LSP client before shutting down the kernel. We only give
			// the LSP a quarter of a second to shut down before we force the
			// kernel to quit; we need to balance the need to respond to the
			// force-quit quickly with the fact that the LSP will show error
			// messages if we yank the kernel out from beneath it without
			// warning.
			await Promise.race([
				this.deactivateLsp('force quitting session'),
				delay(250)
			]);
			return this._kernel.forceQuit();
		} else {
			throw new Error('Cannot force quit; kernel not started');
		}
	}

	async dispose() {
		// Clean up the console width listener
		this._consoleWidthDisposable?.dispose();
		this._consoleWidthDisposable = undefined;

		await this._lsp.dispose();
		if (this._kernel) {
			await this._kernel.dispose();
		}
	}

	/**
	 * Show runtime log in output panel.
	 */
	showOutput(channel?: positron.LanguageRuntimeSessionChannel) {
		// Show the output for the LSP channel, if requested
		if (channel === positron.LanguageRuntimeSessionChannel.LSP) {
			this._lsp.showOutput();
		} else {
			this._kernel?.showOutput(channel);
		}
	}

	listOutputChannels(): positron.LanguageRuntimeSessionChannel[] {
		const channels = this._kernel?.listOutputChannels?.() ?? [];
		// Add LSP channel in addition to the kernel channels
		return [...channels, positron.LanguageRuntimeSessionChannel.LSP];
	}

	/**
	 * Show profiler log if supported.
	 */
	async showProfile() {
		await this._kernel?.showProfile?.();
	}

	updateSessionName(sessionName: string): void {
		// Update the dynamic state of the session
		this.dynState.sessionName = sessionName;
		this._kernel?.updateSessionName(sessionName);
	}

	/**
	 * Get the LANG env var and all categories of the locale, in R's Sys.getlocale() sense, from
	 * the R session.
	 */
	async getLocale(): Promise<Locale> {
		try {
			const locale: Locale = await this.callMethod('get_locale');
			return locale;
		} catch (err) {
			const runtimeError = err as positron.RuntimeMethodError;
			throw new Error(`Error getting locale information: ${runtimeError.message} ` +
				`(${runtimeError.code})`);
		}
	}

	/**
	 * Get environment variables from the R session.
	 */
	async getEnvVars(envVarNames: string[]): Promise<EnvVar[]> {
		try {
			const envVars: EnvVar[] = await this.callMethod('get_env_vars', envVarNames);
			return envVars;
		} catch (err) {
			const runtimeError = err as positron.RuntimeMethodError;
			throw new Error(`Error getting environment variable(s) ${envVarNames}: ${runtimeError.message} ` +
				`(${runtimeError.code})`);
		}
	}

	/**
	 * Gets information from the runtime about a specific installed package (or maybe not
	 *   installed). This method caches the results of the package check and, by default, consults
	 *   this cache in subsequent calls. If positron-r initiates package installation via
	 *   checkInstalled(), we update the cache. But our cache does not reflect changes made through
	 *   other channels.
	 * @param pkgName The name of the package to check.
	 * @param minimumVersion Optionally, a minimum version to check for. This may seem weird, but we
	 *   need R to compare versions for us. We can't easily do it over here.
	 * @param refresh If true, removes any cache entry for pkgName (without regard to
	 *   minimumVersion), gets fresh info from the runtime, and caches it.
	 * @returns An instance of RPackageInstallation if the package is installed, `null` otherwise.
	 */
	public async packageVersion(
		pkgName: string,
		minimumVersion: string | null = null,
		refresh: boolean = false
	): Promise<RPackageInstallation | null> {
		const cacheKey = `${pkgName}>=${minimumVersion ?? '0.0.0'}`;

		if (!refresh) {
			if (this._packageCache.has(cacheKey)) {
				return this._packageCache.get(cacheKey)!;
			}

			if (minimumVersion === null) {
				for (const key of this._packageCache.keys()) {
					if (key.startsWith(pkgName)) {
						return this._packageCache.get(key)!;
					}
				}
			}
		}
		// Possible sceanrios:
		// - We're skipping the cache and refreshing the package info.
		// - The package isn't in the cache.
		// - The package is in the cache, but version is insufficient (last time we checked).

		// Remove a pre-existing cache entry for this package, regardless of minimumVersion.
		for (const key of this._packageCache.keys()) {
			if (key.startsWith(pkgName)) {
				this._packageCache.delete(key);
			}
		}

		const pkgInst = await this._getPackageVersion(pkgName, minimumVersion);

		if (pkgInst) {
			this._packageCache.set(cacheKey, pkgInst);
		}

		return pkgInst;
	}

	private async _getPackageVersion(
		pkgName: string,
		minimumVersion: string | null = null
	): Promise<RPackageInstallation | null> {
		let pkg: any;
		try {
			pkg = await this.callMethod('packageVersion', pkgName, minimumVersion);
		} catch (err) {
			const runtimeError = err as positron.RuntimeMethodError;
			throw new Error(`Error getting version of package ${pkgName}: ${runtimeError.message} (${runtimeError.code})`);
		}

		if (pkg.version === null) {
			return null;
		}

		const pkgInst: RPackageInstallation = {
			packageName: pkgName,
			packageVersion: pkg.version,
			minimumVersion: minimumVersion ?? '0.0.0',
			compatible: pkg.compatible
		};

		return pkgInst;
	}

	/**
	 * Checks whether a package is installed in the runtime, possibly at a minimum version. If not,
	 * prompts the user to install the package. See the documentation for `packageVersion() for some
	 * caveats around caching.
	 * @param pkgName The name of the package to check.
	 * @param minimumVersion Optionally, the version of the package needed.
	 * @returns true if the package is installed, at a sufficient version, false otherwise.
	 */

	async checkInstalled(pkgName: string, minimumVersion: string | null = null): Promise<boolean> {
		let pkgInst = await this.packageVersion(pkgName, minimumVersion);
		const installed = pkgInst !== null;
		let compatible = pkgInst?.compatible ?? false;
		if (compatible) {
			return true;
		}
		// One of these is true:
		// - Package is not installed.
		// - Package is installed, but version is insufficient.
		// - (Our cache gave us outdated info, but we're just accepting this risk.)

		const title = installed
			? vscode.l10n.t('Insufficient package version')
			: vscode.l10n.t('Missing R package');
		const message = installed
			? vscode.l10n.t(
				'The {0} package is installed at version {1}, but version {2} is required.',
				pkgName, pkgInst!.packageVersion, minimumVersion as string
			)
			: vscode.l10n.t('The {0} package is required, but not installed.', pkgName);
		const okButtonTitle = installed
			? vscode.l10n.t('Update now')
			: vscode.l10n.t('Install now');

		const install = await positron.window.showSimpleModalDialogPrompt(
			title,
			message,
			okButtonTitle
		);
		if (!install) {
			return false;
		}

		const id = randomUUID();

		// A promise that resolves when the runtime is idle:
		const promise = new Promise<void>(resolve => {
			const disp = this.onDidReceiveRuntimeMessage(runtimeMessage => {
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

		this.execute(`install.packages("${pkgName}")`,
			id,
			positron.RuntimeCodeExecutionMode.Interactive,
			positron.RuntimeErrorBehavior.Continue);

		// Wait for the the runtime to be idle, or for the timeout:
		await Promise.race([promise, timeout(2e4, 'waiting for package installation')]);

		pkgInst = await this.packageVersion(pkgName, minimumVersion, true);
		compatible = pkgInst?.compatible ?? false;
		return compatible;
	}

	async isPackageAttached(packageName: string): Promise<boolean> {
		let attached = false;

		try {
			attached = await this.callMethod('isPackageAttached', packageName);
		} catch (err) {
			const runtimeError = err as positron.RuntimeMethodError;
			vscode.window.showErrorMessage(vscode.l10n.t(
				`Error checking if '${packageName}' is attached: ${runtimeError.message} ` +
				`(${runtimeError.code})`
			));
		}

		return attached;
	}

	private async createKernel(): Promise<JupyterLanguageRuntimeSession> {
		// Get the Positron Supervisor extension and activate it if necessary
		const ext = vscode.extensions.getExtension('positron.positron-supervisor');
		if (!ext) {
			throw new Error('Positron Supervisor extension not found');
		}
		if (!ext.isActive) {
			await ext.activate();
		}
		this.adapterApi = ext?.exports as PositronSupervisorApi;

		// Create the Jupyter session
		const kernel = this.kernelSpec ?
			// We have a kernel spec, so create a new session
			await this.adapterApi.createSession(
				this.runtimeMetadata,
				this.metadata,
				this.kernelSpec,
				this.dynState,
				this.extra) :

			// We don't have a kernel spec, so restore (reconnect) the session
			await this.adapterApi.restoreSession(
				this.runtimeMetadata,
				this.metadata,
				this.dynState);

		kernel.onDidChangeRuntimeState((state) => {
			this._stateEmitter.fire(state);
		});
		kernel.onDidReceiveRuntimeMessage((message) => {
			this.onMessage(message);
		});
		kernel.onDidEndSession((exit) => {
			this._exitEmitter.fire(exit);
		});

		return kernel;
	}

	/**
	 * Processes a message received from the kernel; amends it with any
	 * necessary metadata and then emits it to Positron.
	 *
	 * @param message The message to process
	 */
	private onMessage(message: positron.LanguageRuntimeMessage): void {
		// Have we delivered the message to Positron yet?
		let delivered = false;

		if (message.type === positron.LanguageRuntimeMessageType.Output) {

			// If this is an R HTML widget, upgrade the message to a web output
			const msg = message as positron.LanguageRuntimeOutput;
			if (Object.keys(msg.data).includes('application/vnd.r.htmlwidget')) {

				// Get the widget data from the message
				const widget = msg.data['application/vnd.r.htmlwidget'] as any as RHtmlWidget;
				const webMsg = msg as positron.LanguageRuntimeWebOutput;

				// Compute all the resource roots; these are the URIs the widget
				// will need to render.
				webMsg.resource_roots = getResourceRoots(widget);

				// Set the output location based on the sizing policy
				const sizing = widget.sizing_policy;
				webMsg.output_location = sizing?.knitr?.figure ?
					positron.PositronOutputLocation.Plot :
					positron.PositronOutputLocation.Viewer;

				// Deliver the message to Positron
				this._messageEmitter.fire(message);
				delivered = true;
			}
		}

		// The message hasn't been delivered yet, so deliver it
		if (!delivered) {
			this._messageEmitter.fire(message);
		}
	}

	/**
	 * Start the LSP
	 *
	 * Returns a promise that resolves when the LSP has been activated.
	 *
	 * Should never be called within `RSession`, only a session manager
	 * should call this.
	 */
	public async activateLsp(reason: string): Promise<void> {
		this._kernel?.emitJupyterLog(
			`Queuing LSP activation. Reason: ${reason}. ` +
			`Queue size: ${this._lspQueue.size}, ` +
			`pending: ${this._lspQueue.pending}`,
			vscode.LogLevel.Debug,
		);
		return this._lspQueue.add(async () => {
			if (!this._kernel) {
				LOGGER.warn('Cannot activate LSP; kernel not started');
				return;
			}

			this._kernel.emitJupyterLog(
				`LSP activation started. Reason: ${reason}. ` +
				`Queue size: ${this._lspQueue.size}, ` +
				`pending: ${this._lspQueue.pending}`,
				vscode.LogLevel.Debug,
			);

			if (this._lsp.state !== LspState.stopped && this._lsp.state !== LspState.uninitialized) {
				this._kernel.emitJupyterLog('LSP already active', vscode.LogLevel.Debug);
				return;
			}

			this._kernel.emitJupyterLog('Starting Positron LSP server');

			// Create the LSP comm, which also starts the LSP server.
			// We await the server selected port (the server selects the
			// port since it is in charge of binding to it, which avoids
			// race conditions). We also use this promise to avoid restarting
			// in the middle of initialization.
			this._lspClientId = this._kernel.createPositronLspClientId();
			this._lspStartingPromise = this._kernel.startPositronLsp(this._lspClientId, '127.0.0.1');
			let port: number;
			try {
				port = await this._lspStartingPromise;
			} catch (err) {
				this._kernel.emitJupyterLog(`Error starting Positron LSP: ${err}`, vscode.LogLevel.Error);
				return;
			}

			this._kernel.emitJupyterLog(`Starting Positron LSP client on port ${port}`);

			await this._lsp.activate(port);
		});
	}

	/**
	 * Stops the LSP if it is running
	 *
	 * Returns a promise that resolves when the LSP has been deactivated.
	 *
	 * The session manager is in charge of starting up the LSP, so
	 * `activateLsp()` should never be called from `RSession`, but the session
	 * itself may need to call `deactivateLsp()`. This is okay for now, the
	 * important thing is that an LSP should only ever be started up by a
	 * session manager to ensure that other LSPs are deactivated first.
	 *
	 * Avoid calling `this._lsp.deactivate()` directly, use this instead
	 * to enforce usage of the `_lspQueue`.
	 */
	public async deactivateLsp(reason: string): Promise<void> {
		this._kernel?.emitJupyterLog(
			`Queuing LSP deactivation. Reason: ${reason}. ` +
			`Queue size: ${this._lspQueue.size}, ` +
			`pending: ${this._lspQueue.pending}`,
			vscode.LogLevel.Debug,
		);
		return this._lspQueue.add(async () => {
			this._kernel?.emitJupyterLog(
				`LSP deactivation started. Reason: ${reason}. ` +
				`Queue size: ${this._lspQueue.size}, ` +
				`pending: ${this._lspQueue.pending}`,
				vscode.LogLevel.Debug,
			);
			if (this._lsp.state !== LspState.running) {
				this._kernel?.emitJupyterLog('LSP already deactivated', vscode.LogLevel.Debug);
				return;
			}
			this._kernel?.emitJupyterLog(`Stopping Positron LSP server`);
			await this._lsp.deactivate();
			if (this._lspClientId) {
				this._kernel?.removeClient(this._lspClientId);
				this._lspClientId = undefined;
			}
			this._kernel?.emitJupyterLog(`Positron LSP server stopped`, vscode.LogLevel.Debug);
		});
	}

	/**
	 * Wait for the LSP to be connected.
	 *
	 * Resolves to `ArkLsp` if the LSP is connected, or once the LSP is connected
	 * if it's starting up. Resolves to `undefined` if the LSP has been stopped. Rejects
	 * if the LSP fails to start.
	 */
	async waitLsp(): Promise<ArkLsp | undefined> {
		if (await this._lsp.wait()) {
			return this._lsp;
		} else {
			return undefined;
		}
	}

	/**
	 * Start the DAP
	 *
	 * Returns a promise that resolves when the DAP has been activated.
	 *
	 * Unlike the LSP, the DAP can activate immediately. It is only actually
	 * connected to a DAP client when a `start_debug` message is sent from the
	 * foreground Ark session to Positron, so it won't interfere with any other
	 * sessions by coming online.
	 */
	private async startDap(): Promise<void> {
		if (this._kernel) {
			try {
				let clientId = this._kernel.createPositronDapClientId();
				await this._kernel.startPositronDap(clientId, 'ark', 'Ark Positron R');
			} catch (err) {
				this._kernel.emitJupyterLog(`Error starting DAP: ${err}`, vscode.LogLevel.Error);
			}
		}
	}

	private async onStateChange(state: positron.RuntimeState): Promise<void> {
		this._state = state;
		if (state === positron.RuntimeState.Ready) {
			await this.startDap();
			await this.setConsoleWidth();
		} else if (state === positron.RuntimeState.Exited) {
			await this.deactivateLsp('session exited');
		}
	}

	private async setConsoleWidth(): Promise<void> {
		try {
			// Set the initial console width
			const width = await positron.window.getConsoleWidth();
			this.callMethod('setConsoleWidth', width);
			this._kernel?.emitJupyterLog(`Set initial console width to ${width}`);
		} catch (err) {
			// Recoverable (we'll just use the default width); but log
			// the error.
			const runtimeError = err as positron.RuntimeMethodError;
			this._kernel?.emitJupyterLog(
				`Error setting initial console width: ${runtimeError.message} (${runtimeError.code})`,
				vscode.LogLevel.Error,
			);
		}
	}

	/**
	 * Shows a help topic in the Positron help viewer.
	 *
	 * @param topic The help topic to show.
	 */
	private async showHelpTopic(topic: string): Promise<void> {
		try {
			// showHelpTopic returns a logical value indicating whether the
			// topic was found. If it wasn't, we'll show an error message.
			const result = await this.callMethod('showHelpTopic', topic);
			if (!result) {
				vscode.window.showWarningMessage(
					`The requested help topic '${topic}' was not found.`);
			}
		} catch (err) {
			const runtimeError = err as positron.RuntimeMethodError;
			vscode.window.showErrorMessage(
				`Error showing help topic '${topic}': ${runtimeError.message} ` +
				`(${runtimeError.code})`);
		}
	}

	/**
	 * Shows a vignette topic in the Positron help viewer.
	 *
	 * @param topic The vignette topic to show.
	 */
	private async showVignetteTopic(topic: string): Promise<void> {
		try {
			const result = await this.callMethod('showVignetteTopic', topic);
			if (!result) {
				vscode.window.showWarningMessage(
					`The requested vignette topic '${topic}' was not found.`);
			}
		} catch (err) {
			const runtimeError = err as positron.RuntimeMethodError;
			vscode.window.showErrorMessage(
				`Error showing vignette topic '${topic}': ${runtimeError.message} ` +
				`(${runtimeError.code})`);
		}
	}
}

export function createJupyterKernelExtra(): JupyterKernelExtra {
	return {
		attachOnStartup: new ArkAttachOnStartup(),
		sleepOnStartup: new ArkDelayStartup(),
	};
}

export async function checkInstalled(pkgName: string,
	pkgVersion?: string,
	session?: RSession): Promise<boolean> {
	session = session || RSessionManager.instance.getConsoleSession();
	if (session) {
		return session.checkInstalled(pkgName, pkgVersion);
	}
	throw new Error(`Cannot check install status of ${pkgName}; no R session available`);
}

export async function getLocale(session?: RSession): Promise<Locale> {
	session = session || RSessionManager.instance.getConsoleSession();
	if (session) {
		return session.getLocale();
	}
	throw new Error(`Cannot get locale information; no R session available`);
}

export async function getEnvVars(envVars: string[], session?: RSession): Promise<EnvVar[]> {
	session = session || RSessionManager.instance.getConsoleSession();
	if (session) {
		return session.getEnvVars(envVars);
	}
	throw new Error(`Cannot get env var information; no R session available`);
}
