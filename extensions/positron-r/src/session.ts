/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as path from 'path';
import PQueue from 'p-queue';

import { JupyterAdapterApi, JupyterKernelSpec, JupyterLanguageRuntimeSession, JupyterKernelExtra } from './jupyter-adapter';
import { ArkLsp, LspState } from './lsp';
import { delay, whenTimeout, timeout } from './util';
import { ArkAttachOnStartup, ArkDelayStartup } from './startup';
import { RHtmlWidget, getResourceRoots } from './htmlwidgets';
import { getArkKernelPath } from './kernel';
import { randomUUID } from 'crypto';
import { handleRCode } from './hyperlink';
import { RSessionManager } from './session-manager';
import { EXTENSION_ROOT_DIR } from './constants';
import { getPandocPath } from './pandoc';

interface RPackageInstallation {
	packageName: string;
	packageVersion?: string;
}

// At the time of writing, we only use LANG, but we expect other aspects of the active R session's
// locale to also be present here, such as LC_CTYPE or LC_TIME. These can vary by OS, so this
// interface doesn't attempt to enumerate them.
interface Locale {
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

	/** Queue for message handlers */
	private _queue: PQueue;

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

	/** The Jupyter Adapter extension API */
	private adapterApi?: JupyterAdapterApi;

	/** The registration for console width changes */
	private _consoleWidthDisposable?: vscode.Disposable;

	/** The current state of the runtime */
	private _state: positron.RuntimeState = positron.RuntimeState.Uninitialized;

	/** A timestamp assigned when the session was created. */
	private _created: number;

	/** Cache for which packages we know are installed in this runtime **/
	private _packageCache = new Array<RPackageInstallation>();

	/** The current dynamic runtime state */
	public dynState: positron.LanguageRuntimeDynState;

	constructor(
		readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
		readonly metadata: positron.RuntimeSessionMetadata,
		readonly context: vscode.ExtensionContext,
		readonly kernelSpec?: JupyterKernelSpec,
		readonly extra?: JupyterKernelExtra,
	) {
		this._lsp = new ArkLsp(runtimeMetadata.languageVersion, metadata);
		this._queue = new PQueue({ concurrency: 1 });
		this.onDidReceiveRuntimeMessage = this._messageEmitter.event;
		this.onDidChangeRuntimeState = this._stateEmitter.event;
		this.onDidEndSession = this._exitEmitter.event;

		this.dynState = {
			continuationPrompt: '+',
			inputPrompt: '>',
		};

		// Timestamp the session creation
		this._created = Date.now();

		// Register this session with the session manager
		RSessionManager.instance.setSession(metadata.sessionId, this);

		this.onDidChangeRuntimeState((state) => {
			this.onStateChange(state);
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
				`Error setting console width: ${runtimeError.message} ` +
				`(${runtimeError.code})`);
		}
	}

	async interrupt(): Promise<void> {
		if (this._kernel) {
			return this._kernel.interrupt();
		} else {
			throw new Error('Cannot interrupt; kernel not started');
		}
	}

	// Keep track of LSP init to avoid stopping in the middle of startup
	private _lspStarting: Promise<void> = Promise.resolve();

	async restart(): Promise<void> {
		if (this._kernel) {
			// Stop the LSP client before restarting the kernel. Don't stop it
			// until fully started to avoid an inconsistent state where the
			// deactivation request comes in between the creation of the LSP
			// comm and the LSP client.
			//
			// A cleaner way to set this up might be to put `this._lsp` in
			// charge of creating the LSP comm, then `deactivate()` could
			// keep track of this state itself.
			await Promise.race([
				this._lspStarting,
				whenTimeout(400, () => {
					this._kernel!.emitJupyterLog('LSP startup timed out during interpreter restart');
				})
			]);
			await this._lsp.deactivate(true);
			return this._kernel.restart();
		} else {
			throw new Error('Cannot restart; kernel not started');
		}
	}

	async shutdown(exitReason = positron.RuntimeExitReason.Shutdown): Promise<void> {
		if (this._kernel) {
			// Stop the LSP client before shutting down the kernel
			await this._lsp.deactivate(true);
			return this._kernel.shutdown(exitReason);
		} else {
			throw new Error('Cannot shutdown; kernel not started');
		}
	}

	async forceQuit(): Promise<void> {
		if (this._kernel) {
			// Stop the LSP client before shutting down the kernel. We only give
			// the LSP a quarter of a second to shut down before we force the
			// kernel to quit; we need to balance the need to respond to the
			// force-quit quickly with the fact that the LSP will show error
			// messages if we yank the kernel out from beneath it without
			// warning.
			await Promise.race([
				this._lsp.deactivate(true),
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
	showOutput() {
		this._kernel?.showOutput();
	}

	/**
	 * Show profiler log if supported.
	 */
	async showProfile() {
		await this._kernel?.showProfile?.();
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
	 * Checks whether a package is installed in the runtime.
	 * @param pkgName The name of the package to check
	 * @param pkgVersion Optionally, the version of the package needed
	 * @returns true if the package is installed, false otherwise
	 */

	async checkInstalled(pkgName: string, pkgVersion?: string): Promise<boolean> {
		let isInstalled: boolean;
		// Check the cache first
		if (this._packageCache.includes({ packageName: pkgName, packageVersion: pkgVersion }) ||
			(pkgVersion === undefined && this._packageCache.some(p => p.packageName === pkgName))) {
			return true;
		}
		try {
			if (pkgVersion) {
				isInstalled = await this.callMethod('is_installed', pkgName, pkgVersion);
			} else {
				isInstalled = await this.callMethod('is_installed', pkgName);
			}
		} catch (err) {
			const runtimeError = err as positron.RuntimeMethodError;
			throw new Error(`Error checking for package ${pkgName}: ${runtimeError.message} ` +
				`(${runtimeError.code})`);
		}

		if (!isInstalled) {
			const message = pkgVersion ? vscode.l10n.t('Package `{0}` version `{1}` required but not installed.', pkgName, pkgVersion)
				: vscode.l10n.t('Package `{0}` required but not installed.', pkgName);
			const install = await positron.window.showSimpleModalDialogPrompt(
				vscode.l10n.t('Missing R package'),
				message,
				vscode.l10n.t('Install now')
			);
			if (install) {
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

				return true;
			} else {
				return false;
			}
		}
		this._packageCache.push({ packageName: pkgName, packageVersion: pkgVersion });
		return true;
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
		const ext = vscode.extensions.getExtension('vscode.jupyter-adapter');
		if (!ext) {
			throw new Error('Jupyter Adapter extension not found');
		}
		if (!ext.isActive) {
			await ext.activate();
		}
		this.adapterApi = ext?.exports as JupyterAdapterApi;

		// Create the Jupyter session
		const kernel = this.kernelSpec ?
			// We have a kernel spec, so create a new session
			this.adapterApi.createSession(
				this.runtimeMetadata,
				this.metadata,
				this.kernelSpec,
				this.dynState,
				this.extra) :

			// We don't have a kernel spec, so restore (reconnect) the session
			this.adapterApi.restoreSession(
				this.runtimeMetadata,
				this.metadata);

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

	private async startLsp(): Promise<void> {
		// The adapter API is guaranteed to exist at this point since the
		// runtime cannot become Ready without it
		const port = await this.adapterApi!.findAvailablePort([], 25);
		if (this._kernel) {
			this._kernel.emitJupyterLog(`Starting Positron LSP server on port ${port}`);
			await this._kernel.startPositronLsp(`127.0.0.1:${port}`);
		}
		this._lsp.activate(port, this.context);
	}

	/**
	 * Wait for the LSP to be connected.
	 *
	 * Resolves to `true` once the LSP is connected. Resolves to `false` if the
	 * LSP has been stopped. Rejects if the LSP fails to start.
	 */
	async waitLsp(): Promise<boolean> {
		return await this._lsp.wait();
	}

	private async startDap(): Promise<void> {
		if (this._kernel) {
			const port = await this.adapterApi!.findAvailablePort([], 25);
			await this._kernel.startPositronDap(port, 'ark', 'Ark Positron R');
		}
	}

	private onStateChange(state: positron.RuntimeState): void {
		this._state = state;
		if (state === positron.RuntimeState.Ready) {
			// Start the LSP and DAP servers
			this._queue.add(async () => {
				const lsp = this.startLsp();
				this._lspStarting = lsp;

				const dap = this.startDap();
				await Promise.all([lsp, dap]);
			});

			this._queue.add(async () => {
				try {
					// Set the initial console input width
					const width = await positron.window.getConsoleWidth();
					this.callMethod('setConsoleWidth', width);
					this._kernel!.emitJupyterLog(`Set initial console width to ${width}`);
				} catch (err) {
					// Recoverable (we'll just use the default width); but log
					// the error.
					if (this._kernel) {
						const runtimeError = err as positron.RuntimeMethodError;
						this._kernel.emitJupyterLog(
							`Error setting initial console width: ${runtimeError.message} ` +
							`(${runtimeError.code})`);
					}
				}
			});

		} else if (state === positron.RuntimeState.Exited) {
			if (this._lsp.state === LspState.running) {
				this._queue.add(async () => {
					if (this._kernel) {
						this._kernel.emitJupyterLog(`Stopping Positron LSP server`);
					}
					await this._lsp.deactivate(false);
				});
			}
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

/**
 * Create a new Jupyter kernel spec.
 *
 * @param rHomePath The R_HOME path for the R version
 * @param runtimeName The (display) name of the runtime
 * @param sessionMode The mode in which to create the session
 *
 * @returns A JupyterKernelSpec definining the kernel's path, arguments, and
 *  metadata.
 */
export function createJupyterKernelSpec(
	rHomePath: string,
	runtimeName: string,
	sessionMode: positron.LanguageRuntimeSessionMode): JupyterKernelSpec {

	// Path to the kernel executable
	const kernelPath = getArkKernelPath();
	if (!kernelPath) {
		throw new Error('Unable to find R kernel');
	}

	// Check the R kernel log level setting
	const config = vscode.workspace.getConfiguration('positron.r');
	const logLevel = config.get<string>('kernel.logLevel') ?? 'warn';
	const logLevelForeign = config.get<string>('kernel.logLevelExternal') ?? 'warn';
	const userEnv = config.get<object>('kernel.env') ?? {};
	const profile = config.get<string>('kernel.profile');


	/* eslint-disable */
	const env = <Record<string, string>>{
		'RUST_BACKTRACE': '1',
		'RUST_LOG': logLevelForeign + ',ark=' + logLevel,
		'R_HOME': rHomePath,
		...userEnv
	};
	/* eslint-enable */

	if (profile) {
		env['ARK_PROFILE'] = profile;
	}

	if (process.platform === 'linux') {
		// Workaround for
		// https://github.com/posit-dev/positron/issues/1619#issuecomment-1971552522
		env['LD_LIBRARY_PATH'] = rHomePath + '/lib';
	} else if (process.platform === 'darwin') {
	        // Workaround for
	        // https://github.com/posit-dev/positron/issues/3732
		env['DYLD_LIBRARY_PATH'] = rHomePath + '/lib';
	}

	// Inject the path to the Pandoc executable into the environment; R packages
	// that use Pandoc for rendering will need this.
	//
	// On MacOS, the binary path lives alongside the app bundle; on other
	// platforms, it's a couple of directories up from the app root.
	const pandocPath = getPandocPath();
	if (pandocPath) {
		env['RSTUDIO_PANDOC'] = pandocPath;
	}

	// R script to run on session startup
	const startupFile = path.join(EXTENSION_ROOT_DIR, 'resources', 'scripts', 'startup.R');

	const argv = [
		kernelPath,
		'--connection_file', '{connection_file}',
		'--log', '{log_file}',
		'--startup-file', `${startupFile}`,
		'--session-mode', `${sessionMode}`,
	];

	// Only create profile if requested in configuration
	if (profile) {
		argv.push(...[
			'--profile', '{profile_file}',
		]);
	}

	argv.push(...[
		// The arguments after `--` are passed verbatim to R
		'--',
		'--interactive',
	]);

	// Create a kernel spec for this R installation
	const kernelSpec: JupyterKernelSpec = {
		'argv': argv,
		'display_name': runtimeName, // eslint-disable-line
		'language': 'R',
		'env': env,
	};

	// Unless the user has chosen to restore the workspace, pass the
	// `--no-restore-data` flag to R.
	if (!config.get<boolean>('restoreWorkspace')) {
		kernelSpec.argv.push('--no-restore-data');
	}

	// If the user has supplied extra arguments to R, pass them along.
	const extraArgs = config.get<Array<string>>('extraArguments');
	const quietMode = config.get<boolean>('quietMode');
	if (quietMode && extraArgs?.indexOf('--quiet') === -1) {
		extraArgs?.push('--quiet');
	}
	if (extraArgs) {
		kernelSpec.argv.push(...extraArgs);
	}

	return kernelSpec;
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
