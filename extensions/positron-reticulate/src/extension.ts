/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import path = require('path');
import fs = require('fs');
import { JupyterKernelSpec, JupyterSession, JupyterKernel } from './positron-supervisor';
import { Barrier, PromiseHandles, withTimeout } from './async';
import uuid = require('uuid');

interface ReticulateSessionInfo {
	reticulateSessionId: string;
	hostRSessionId: string;
	reticulateId: string;
}

export class ReticulateRuntimeManager implements positron.LanguageRuntimeManager {

	_sessions: Map<string, positron.LanguageRuntimeSession> = new Map();

	// This field contains the reticulate runtime metadata. It's only set once the
	// runtime has been registered.
	_metadata?: positron.LanguageRuntimeMetadata;

	// This is returned by positron when we register a listener to the onDidDiscoverRuntime
	// event. We wait until R runtimes are registered to register the reticulate runtime,
	// but once the reticulate runtime is registered, we need to dispose of this.
	_registrationHook?: vscode.Disposable;

	// Positron listens to this event and will update its UI once it's fired with
	// a new runtime.
	onDidDiscoverRuntime?: vscode.Event<positron.LanguageRuntimeMetadata>;
	onDidDiscoverRuntimeEmmiter?: vscode.EventEmitter<positron.LanguageRuntimeMetadata>;

	constructor(
		private readonly _context: vscode.ExtensionContext,
	) {
		this.onDidDiscoverRuntimeEmmiter = new vscode.EventEmitter<positron.LanguageRuntimeMetadata>;
		this.onDidDiscoverRuntime = this.onDidDiscoverRuntimeEmmiter.event;

		vscode.workspace.onDidChangeConfiguration((event) => {
			if (this._metadata) {
				return; // If the runtime is already registered, don't do anything
			}
			if (event.affectsConfiguration('positron.reticulate.enabled') && this.featureEnabled()) {
				this.maybeRegisterReticulateRuntime();
			}
		});

		if (this.featureEnabled()) {
			this.maybeRegisterReticulateRuntime();
		}
	}

	featureEnabled(): boolean | undefined {
		// If it's disabled, don't do any registration
		const config = vscode.workspace.getConfiguration('positron.reticulate');
		const option = config.get<('auto' | 'never' | 'always') | boolean>('enabled');

		if (typeof option === 'boolean') {
			// Keep supporting the old option which was a boolean.
			return option; // If it's a boolean, return it directly
		}

		switch (option) {
			case 'auto':
				const val = CONTEXT.workspaceState.get(autoEnabledStorageKey, false);
				return val;
			case 'never':
				return false;
			case 'always':
				return true;
		}
	}

	async maybeRegisterReticulateRuntime() {

		if (this._metadata) {
			return; // No-op if session is already registered.
		}

		if (!this.featureEnabled()) {
			return;
		}

		// Get a fixed list of all current runtimes.
		const runtimes = await positron.runtime.getRegisteredRuntimes();

		// Hook that will register the reticulate runtime if an R
		// runtime is found.
		this._registrationHook = positron.runtime.onDidRegisterRuntime((metadata) => {
			if (!this._metadata && metadata.languageId === 'r') {
				this.registerReticulateRuntime();
			}
		});

		this._context.subscriptions.push(this._registrationHook);

		// Walk trough the list of runtimes looking for an R runtime,
		// if one exists we register the reticulate runtime.
		for (const runtime of runtimes) {
			if (!this._metadata && runtime.languageId === 'r') {
				this.registerReticulateRuntime();
				return;
			}
		}
	}

	registerReticulateRuntime() {
		LOGGER.info('Registering the reticulate runtime');
		this._metadata = new ReticulateRuntimeMetadata();
		this.onDidDiscoverRuntimeEmmiter?.fire(this._metadata);

		if (this._registrationHook) {
			this._registrationHook.dispose();
			this._registrationHook = undefined;
		}
	}

	discoverAllRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
		// We never discover a runtime directly. We'll always check if R is available
		// and then fire the onDidDiscoverRuntime event.
		return (async function* () { })();
	}

	async recommendedWorkspaceRuntime(): Promise<positron.LanguageRuntimeMetadata | undefined> {
		return undefined;
	}

	async createSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata): Promise<positron.LanguageRuntimeSession> {
		LOGGER.info(`Creating Reticulate session. sessionId: ${sessionMetadata.sessionId}`);
		const sessionPromise = new PromiseHandles<positron.LanguageRuntimeSession>();
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Creating the Reticulate Python session',
			cancellable: false
		}, async (progress, _token) => {
			let session: ReticulateRuntimeSession | undefined;
			try {
				session = await this.createSession_(runtimeMetadata, sessionMetadata, progress);
				sessionPromise.resolve(session);
			} catch (err: any) {
				sessionPromise.reject(err);
				// When an error happens trying to create a session, we'll create a notification
				// to show the error to the user.
				// Initialization only requires a message.
				let error = err;
				if (!(err instanceof InitializationError)) {
					error = new InitializationError(err.message);
				}
				error.showAsNotification();
				throw err;
			}

			// Wait for the session to start (or fail to start) before
			// returning from this callback, so that the progress bar stays up
			// while we wait.
			progress.report({ increment: 10, message: vscode.l10n.t('Waiting to connect') });
			await session.started.wait();
		});
		return sessionPromise.promise;
	}

	async createSession_(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata, progress: vscode.Progress<{ message?: string; increment: number }>): Promise<ReticulateRuntimeSession> {
		progress.report({ increment: 10, message: vscode.l10n.t('Finding the host the R session') });
		const sessions = await positron.runtime.getActiveSessions();
		const usedRSessions = this.getSessions().map((pair) => pair.hostRSessionId);

		const freeRSessions = sessions.filter(sess => {
			return sess.runtimeMetadata.languageId === 'r' &&
				!usedRSessions.find((x) => x === sess.metadata.sessionId);
		});

		const rSession = await (async () => {
			if (freeRSessions.length > 0) {
				// We have a free R session, we can attach to it. First we need to figure out if there's
				// a prefered one.
				// TODO: maybe show a quick menu so the user can select the session they want to attach to?
				return freeRSessions[0];
			} else {
				progress.report({ increment: 2, message: vscode.l10n.t('Starting a new R session') });
				// We need to create a new R session.
				const rRuntime = await positron.runtime.getPreferredRuntime('r');
				if (rRuntime) {
					return await positron.runtime.startLanguageRuntime(rRuntime.runtimeId, rRuntime.runtimeName);
				} else {
					throw new InitializationError(vscode.l10n.t('No R interpreter is available'));
				}
			}
		})();

		progress.report({ increment: 5, message: vscode.l10n.t('Waiting for the R session to be ready') });
		const reticulateId = await (async () => {
			// We need to wait for the R session to be fully started.
			// We might need to make some attemps.
			for (let attempt = 1; attempt <= 20; attempt++) {
				try {
					return await rSession.callMethod?.('reticulate_id') as string;
				} catch (err) {
					// Wait a bit before trying again.
					await new Promise(resolve => setTimeout(resolve, 100));
				}
			}
			throw new InitializationError(vscode.l10n.t('Failed to get the reticulate ID'));
		})();
		const session = await ReticulateRuntimeSession.create(runtimeMetadata, sessionMetadata, rSession, progress);
		// Attach the reticulate session to the R session if the reticulate session was successfully created.
		this.setSessions(rSession.metadata.sessionId, reticulateId, session);

		return session;
	}

	setSessions(hostRSessionId: string, reticulateId: string, session: positron.LanguageRuntimeSession) {
		let sessionsMap: ReticulateSessionInfo[] =
			CONTEXT.workspaceState.get('reticulate-sessions-map', []);

		session.onDidEndSession(() => {
			// Remove the session from the map when it ends.
			sessionsMap = sessionsMap.filter((pair) => pair.reticulateSessionId !== session.metadata.sessionId);
			CONTEXT.workspaceState.update('reticulate-sessions-map', sessionsMap);
			this._sessions.delete(session.metadata.sessionId);
		});

		const existingSession = sessionsMap.find((pair) => pair.hostRSessionId === hostRSessionId);
		if (existingSession) {
			existingSession.reticulateSessionId = session.metadata.sessionId;
		} else {
			sessionsMap.push({
				reticulateSessionId: session.metadata.sessionId,
				hostRSessionId: hostRSessionId,
				reticulateId: reticulateId
			});
		}

		this._sessions.set(session.metadata.sessionId, session);
		CONTEXT.workspaceState.update('reticulate-sessions-map', sessionsMap);
	}

	getSessions(): Array<ReticulateSessionInfo> {
		const sessionsMap = CONTEXT.workspaceState.get('reticulate-sessions-map', []);
		return sessionsMap as Array<ReticulateSessionInfo>;
	}

	async restoreSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata): Promise<positron.LanguageRuntimeSession> {
		LOGGER.info(`Restoring Reticulate session. sessionId: ${sessionMetadata.sessionId}`);
		const sessionPromise = new PromiseHandles<positron.LanguageRuntimeSession>();
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Restoring the Reticulate Python session'),
			cancellable: false
		}, async (progress, _token) => {
			let session: ReticulateRuntimeSession | undefined;
			try {
				session = await this.restoreSession_(runtimeMetadata, sessionMetadata, progress);
				sessionPromise.resolve(session as positron.LanguageRuntimeSession);
			} catch (err: any) {
				sessionPromise.reject(err);

				let error = err;
				if (!(err instanceof InitializationError)) {
					error = new InitializationError(err.message);
				}
				error.showAsNotification();
				throw err;
			}
			if (session) {
				// Wait for the session to start (or fail to start) before
				// returning from this callback, so that the progress bar stays up
				// while we wait.
				progress.report({ increment: 10, message: vscode.l10n.t('Waiting to connect') });
				await session.started.wait();
			}
		});
		return sessionPromise.promise;
	}

	async restoreSession_(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata,
		progress: vscode.Progress<{ message?: string; increment?: number }>
	): Promise<ReticulateRuntimeSession> {
		const sessionsMap = this.getSessions();

		// Before restoring we need to find the host R session that this reticulate Python
		// session is attached to. We then need to wait for this R session to be restored
		// before moving on.
		const hostRSessionId = sessionsMap.find((pair) => pair.reticulateSessionId === sessionMetadata.sessionId)?.hostRSessionId;
		if (!hostRSessionId) {
			throw new InitializationError(vscode.l10n.t('Failed to find the host R session for this reticulate session'));
		}

		// Now wait for the host R session to be active.
		// We might need to make some attemps.
		progress.report({ increment: 10, message: vscode.l10n.t('Finding the host R session') });
		const rSession = await (async () => {
			for (let attempt = 1; attempt <= 5; attempt++) {
				const sessions = await positron.runtime.getActiveSessions();
				const hostRSession = sessions.find((sess) => sess.metadata.sessionId === hostRSessionId);
				if (hostRSession) {
					return hostRSession;
				}
				// Wait a bit before trying again.
				await new Promise(resolve => setTimeout(resolve, 500));
			}
			throw new InitializationError(vscode.l10n.t('Failed to find the host R session for this reticulate session'));
		})();

		// Wait and get the reticulateId.
		progress.report({ increment: 10, message: vscode.l10n.t('Waiting for the R session to be ready') });
		const reticulateId = await (async () => {
			// We need to wait for the R session to be fully started.
			// We might need to make some attempts.
			for (let attempt = 1; attempt <= 20; attempt++) {
				try {
					return await rSession.callMethod?.('reticulate_id') as string;
				} catch (err) {
					// Wait a bit before trying again.
					await new Promise(resolve => setTimeout(resolve, 100));
				}
			}
			throw new InitializationError(vscode.l10n.t('Failed to get the reticulate ID'));
		})();

		const session = await ReticulateRuntimeSession.restore(runtimeMetadata, sessionMetadata, rSession, progress);
		this.setSessions(rSession.metadata.sessionId, reticulateId, session);

		return session;
	}

	/**
	 * Validates whether the Reticulate session with the given session ID is active and usable.
	 * @param sessionId The ID of the session to validate.
	 * @returns A promise that resolves to true if the session is valid, false otherwise.
	 */
	async validateSession(sessionId: string): Promise<boolean> {
		LOGGER.info(`Validating Reticulate session. sessionId: ${sessionId}`);
		return Promise.resolve(true);
	}
}

enum ReticulateRuntimeSessionType {
	Create,
	Restore
}

class ReticulateConfig {
	python?: string;
	venv?: string;
	ipykernel?: boolean;
	error?: string;
}

class InitializationError extends Error {
	constructor(readonly message: string, readonly actions: Array<{
		title: string; execute: () => void;
	}> = []) {
		super(message);
	}

	showAsNotification() {
		const display_error = async () => {
			const selection = await vscode.window.showErrorMessage(vscode.l10n.t(
				'Failed to initialize the Reticulate Python session: {0}',
				this.message
			), ...this.actions);

			if (selection && selection.execute) {
				selection.execute();
			}
		};
		display_error();
	}
}

class ReticulateRuntimeSession implements positron.LanguageRuntimeSession {

	private kernel: JupyterKernel | undefined;
	public started = new Barrier();
	private pythonSession: positron.LanguageRuntimeSession;

	// To create a reticulate runtime session we need to first create a python
	// runtime session using the exported interface from the positron-python
	// extension.

	// The PythonRuntimeSession object in the positron-python extensions, is
	// created by passing 'runtimeMetadata', 'sessionMetadata' and something
	// called 'kernelSpec' that's further passed to the JupyterAdapter
	// extension in order to actually initialize the session.

	// ReticulateRuntimeSession are only different from Python runtime sessions
	// in the way the kernel spec is provided. In general, the kernel spec
	// contains a runtime path and some arguments that are used start the
	// kernel process. (The kernel is started by the Positron Supervisor in a
	// vscode terminal). In the reticulate case, the kernel isn't started that
	// way. Instead, we need to call into the R console to start the python
	// jupyter kernel (that's actually running in the same process as R), and
	// only then, ask JupyterAdapter to connect to that kernel.
	static async create(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata,
		rSession: positron.LanguageRuntimeSession,
		progress: vscode.Progress<{ message?: string; increment?: number }>,
	): Promise<ReticulateRuntimeSession> {
		progress.report({ increment: 10, message: vscode.l10n.t('Checking prerequisites') });
		const has_uv_support = await rSession.callMethod?.('is_installed', 'reticulate', '1.40.0.9000');
		const config = ReticulateRuntimeSession.checkRSession(rSession);

		// When uv is available, checking the pre-requisites may ultimately trigger reticulate to install
		// all the required dependencies, which can take a while.
		// We update the message to inform the user that something is happening.
		if (has_uv_support) {
			const timeout = setTimeout(
				() => {
					progress.report({ increment: 2, message: vscode.l10n.t('Installing dependencies. This may take a while.') });
				},
				5000
			);
			config.finally(() => clearTimeout(timeout));
		}

		const metadata = await ReticulateRuntimeSession.fixInterpreterPath(runtimeMetadata, (await config).python);

		// Create the session itself.
		const session = new ReticulateRuntimeSession(
			rSession,
			metadata,
			sessionMetadata,
			ReticulateRuntimeSessionType.Create,
			progress
		);

		return session;
	}

	static async restore(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata,
		rSession: positron.LanguageRuntimeSession,
		progress: vscode.Progress<{ message?: string; increment?: number }>,
	): Promise<ReticulateRuntimeSession> {
		// Make sure the R session has the necessary packages installed.
		progress.report({ increment: 10, message: vscode.l10n.t('Checking prerequisites') });
		const config = await ReticulateRuntimeSession.checkRSession(rSession);
		const metadata = await ReticulateRuntimeSession.fixInterpreterPath(runtimeMetadata, config.python);

		// Create the session itself.
		const session = new ReticulateRuntimeSession(
			rSession,
			metadata,
			sessionMetadata,
			ReticulateRuntimeSessionType.Restore,
			progress
		);

		return session;
	}

	static async checkRSession(rSession: positron.LanguageRuntimeSession): Promise<{ python: string }> {
		// Check that we have a minimum version of reticulate.
		if (!await rSession.callMethod?.('is_installed', 'reticulate', '1.39')) {
			// Offer to install reticulate
			const install_reticulate = await positron.window.showSimpleModalDialogPrompt(
				vscode.l10n.t('Missing reticulate'),
				vscode.l10n.t('Reticulate >= 1.39 is required. Do you want to install reticulate?'),
				'Yes',
				'No'
			);

			if (install_reticulate) {
				try {
					await rSession.callMethod?.('install_packages', 'reticulate');
				} catch (err: any) {
					throw new InitializationError(vscode.l10n.t('Failed to install/update the reticulate package: {0}', err));
				}
			}

			// Make a new check for reticulate
			if (!await rSession.callMethod?.('is_installed', 'reticulate', '1.39')) {
				throw new InitializationError(vscode.l10n.t('Reticulate >= 1.39 is required'));
			}
		}

		let config: ReticulateConfig = {};
		try {
			config = await rSession.callMethod?.('reticulate_check_prerequisites');
		} catch (err: any) {
			// If this times out and reticulate >= 1.41 is installed, it's likely that `uv` wasn't
			// able to install the necessary python packages. We'll throw an initialization error
			// that nicely informs the user to initialize `uv` once.
			if (await rSession.callMethod?.('is_installed', 'reticulate', '1.41')) {
				throw new InitializationError(
					vscode.l10n.t('Timed out setting a Python environment.'),
					[
						{
							title: 'reticulate::py_config()',
							execute: () => {
								positron.runtime.executeCode(
									'r',
									'reticulate::py_config() # This will trigger environment setup',
									true,
									false
								);
							}
						},
					]
				);
			} else {
				throw new InitializationError(
					vscode.l10n.t('Timed out checking that a Python environment is available.'),
				);
			}
		}

		// An error happened, raise it
		if (config.error) {
			throw new InitializationError(vscode.l10n.t('Failed checking for a suitable Python: {0}', config.error));
		}

		// No error, but also no Python:
		if (!config.python) {
			throw new InitializationError(
				vscode.l10n.t('A Python installation is required to execute reticulate.'),
				[
					{
						title: 'reticulate::install_python()',
						execute: () => {
							positron.runtime.executeCode(
								'r',
								'reticulate::install_python() # This may take a few minutes',
								true,
								false
							);
						}
					},
					{
						title: vscode.l10n.t('Open Docs'),
						execute: () => {
							const docsUrl = 'https://rstudio.github.io/reticulate/articles/versions.html';
							vscode.env.openExternal(vscode.Uri.parse(docsUrl));
						}
					}
				]
			);
		}

		// Not a venv
		if (!config.venv) {
			// Reticulate strongly recommends a venv, so we gently inform the user that they
			// are not using a venv, and that they should.

			// TODO: what more can we say here? And what actions can we suggest the use to take?
			const informCreateVirtualEenv = async function () {
				const selection = await vscode.window.showInformationMessage(vscode.l10n.t(`
				Reticulate strongly recommends using a virtualenv.
				`,
					{
						title: 'reticulate::virtualenv_create()',
						execute: () => {
							positron.runtime.executeCode(
								'r',
								'reticulate::virtualenv_create("r-reticulate", packages = c("numpy", "ipykernel"))',
								true,
								false
							);
						}
					}
				));
			};
			// We don't need to await for that, just let they know what we recommend.
			informCreateVirtualEenv();
		}

		return { python: config.python };
	}

	static async fixInterpreterPath(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		interpreterPath: string
	): Promise<positron.LanguageRuntimeMetadata> {

		const output = runtimeMetadata;
		output.runtimePath = interpreterPath;
		output.extraRuntimeData.pythonPath = interpreterPath;

		return output;
	}

	/** An object that emits language runtime events */
	public onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>;

	/** An object that emits the current state of the runtime */
	public onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>;

	/** An object that emits an event when the user's session ends and the runtime exits */
	public onDidEndSession: vscode.Event<positron.LanguageRuntimeExit>;

	/** The emitter for language runtime messages */
	private _messageEmitter = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();

	/** The emitter for language runtime state changes */
	private _stateEmitter = new vscode.EventEmitter<positron.RuntimeState>();

	/** The emitter for language runtime exits */
	private _exitEmitter = new vscode.EventEmitter<positron.LanguageRuntimeExit>();

	constructor(
		readonly rSession: positron.LanguageRuntimeSession,
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		readonly sessionMetadata: positron.RuntimeSessionMetadata,
		readonly sessionType: ReticulateRuntimeSessionType,
		readonly progress: vscode.Progress<{ message?: string; increment?: number }>
	) {
		// When the kernelSpec is undefined, the PythonRuntimeSession
		// will perform a restore session.
		let kernelSpec: JupyterKernelSpec | undefined = undefined;
		if (sessionType === ReticulateRuntimeSessionType.Create) {
			kernelSpec = {
				'argv': [],
				'display_name': "Reticulate Python Session", // eslint-disable-line
				'language': 'Python',
				'env': {},
				'kernel_protocol_version': '5.3',
				'startKernel': async (session, kernel) => {
					try {
						await this.startKernel(session, kernel);
					} catch (err: any) {
						// Any error when trying to start kernel is caught and we send an error
						// notification.
						vscode.window.showErrorMessage(vscode.l10n.t(
							'Failed to initialize and connect to the Reticulate Python session: {0}',
							err.message
						));
						throw err;
					}
				},
			};
		}

		this.onDidReceiveRuntimeMessage = this._messageEmitter.event;
		this.onDidChangeRuntimeState = this._stateEmitter.event;
		this.onDidEndSession = this._exitEmitter.event;

		this.progress.report({ increment: 10, message: vscode.l10n.t('Creating the Python session') });

		this.pythonSession = this.createPythonRuntimeSession(
			runtimeMetadata,
			sessionMetadata,
			kernelSpec
		);
	}

	createPythonRuntimeSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionMetadata: positron.RuntimeSessionMetadata, kernelSpec?: JupyterKernelSpec): positron.LanguageRuntimeSession {
		const api = vscode.extensions.getExtension('ms-python.python');
		if (!api) {
			throw new Error(vscode.l10n.t('Failed to find the Python extension API.'));
		}

		const pythonSession: positron.LanguageRuntimeSession = api.exports.positron.createPythonRuntimeSession(
			runtimeMetadata,
			sessionMetadata,
			kernelSpec
		);

		// Open the start barrier once the session is ready.
		pythonSession.onDidChangeRuntimeState((state) => {
			if (state === positron.RuntimeState.Ready || state === positron.RuntimeState.Idle) {
				this.started.open();
			}
		});

		// Forward the events from the python session to this session.
		pythonSession.onDidReceiveRuntimeMessage((e) => {
			this._messageEmitter.fire(e);
		});
		pythonSession.onDidChangeRuntimeState((e) => {
			this._stateEmitter.fire(e);
		});
		pythonSession.onDidEndSession((e) => {
			this._exitEmitter.fire(e);
		});

		return pythonSession;
	}

	// A function that starts a kernel and then connects to it.
	async startKernel(session: JupyterSession, kernel: JupyterKernel) {
		kernel.log('Starting the Reticulate session!');
		this.progress.report({ increment: 10, message: vscode.l10n.t('Starting the Reticulate session in R') });

		// Store a reference to the kernel, so the session can log, reconnect, etc.
		this.kernel = kernel;

		const connnectionFile = session.state.connectionFile;
		const logFile = session.state.logFile;
		const profileFile = session.state.profileFile;
		const logLevel = 'debug';

		const kernelPath = `${__dirname}/../../positron-python/python_files/posit/positron_language_server.py`;

		if (!this.rSession) {
			kernel.log('No R session :(');
			throw new Error(vscode.l10n.t('No R session to attach the Reticulate Python kernel'));
		}

		if (!this.rSession.callMethod) {
			throw new Error(vscode.l10n.t('No `callMethod` method in the RSession. This is not expected.'));
		}

		const init_err = await this.rSession.callMethod(
			'reticulate_start_kernel',
			kernelPath as string,
			connnectionFile as string,
			logFile as string,
			logLevel as string
		) as string;

		// An empty result means that the initialization went fine.
		if (init_err !== '') {
			throw new Error(vscode.l10n.t(`Reticulate initialization failed: ${init_err}`));
		}

		this.progress.report({ increment: 10, message: vscode.l10n.t('Connecting to the Reticulate session') });

		try {
			await kernel.connectToSession(session);
		} catch (err: any) {
			kernel.log('Failed connecting to the Reticulate Python session');
			throw err;
		} finally {
			this.started.open();
		}
	}

	/**
	 *  Forward properties to the pythonSession.
	 */

	public get metadata() {
		return this.pythonSession.metadata;
	}

	public get runtimeMetadata() {
		return this.pythonSession.runtimeMetadata;
	}

	public get dynState() {
		return this.pythonSession.dynState;
	}

	public get runtimeInfo() {
		return this.pythonSession.runtimeInfo;
	}

	public debug(content: positron.DebugRequest, id: string): void {
		return this.pythonSession.debug(content, id);
	}

	public execute(code: string,
		id: string,
		mode: positron.RuntimeCodeExecutionMode,
		errorBehavior: positron.RuntimeErrorBehavior) {
		return this.pythonSession.execute(code, id, mode, errorBehavior);
	}

	public isCodeFragmentComplete(code: string) {
		return this.pythonSession.isCodeFragmentComplete(code);
	}

	public createClient(id: string, type: positron.RuntimeClientType, params: any, metadata?: any) {
		return this.pythonSession.createClient(id, type, params, metadata);
	}

	public listClients() {
		return this.pythonSession.listClients();
	}

	public removeClient(id: string) {
		return this.pythonSession.removeClient(id);
	}

	public sendClientMessage(client_id: string, message_id: string, message: any) {
		return this.pythonSession.sendClientMessage(client_id, message_id, message);
	}

	public replyToPrompt(id: string, reply: string) {
		return this.pythonSession.replyToPrompt(id, reply);
	}

	public setWorkingDirectory(dir: string): Thenable<void> {
		return this.pythonSession.setWorkingDirectory(dir);
	}

	public start() {
		return this.pythonSession.start();
	}

	public interrupt() {
		return this.pythonSession.interrupt();
	}

	public async restart(workingDirectory: string | undefined) {
		// Sending a restart to the python session will not work simply, because it's
		// tied to the R session.
		// We have to send a restart to the R session, and send a reticulate::repl_python()
		// command to it.
		const restart = await positron.window.showSimpleModalDialogPrompt(
			vscode.l10n.t('Restarting reticulate'),
			vscode.l10n.t('This is will also restart the parent R session. Are you sure you want to continue?'),
			vscode.l10n.t('Yes'),
			vscode.l10n.t('No')
		);

		if (!restart) {
			throw new Error('Restart cancelled.');
		}

		// The events below will make sure that things occur in the right order:
		// 1. shutdown the current reticulate session
		// 2. restart the attached R session
		// 3. start a new reticulate session.
		this.pythonSession.onDidEndSession((sess) => {
			this.rSession.restart(workingDirectory);
		});

		const kernelSpec: JupyterKernelSpec = {
			'argv': [],
			'display_name': "Reticulate Python Session", // eslint-disable-line
			'language': 'Python',
			'env': {},
			'kernel_protocol_version': '5.3',
			'startKernel': async (session, kernel) => {
				try {
					await this.startKernel(session, kernel);
				} catch (err: any) {
					// Any error when trying to start kernel is caught and we send an error
					// notification.
					vscode.window.showErrorMessage(vscode.l10n.t(
						'Failed to initialize and connect to the Reticulate Python session: {0}',
						err.message
					));
					throw err;
				}
			},
		};

		const disposeListener = this.rSession.onDidChangeRuntimeState(async (e) => {
			if (e === positron.RuntimeState.Ready) {

				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'Creating the Reticulate Python session',
					cancellable: false
				}, async (progress, _token) => {
					this.progress.report({ increment: 10, message: vscode.l10n.t('Creating the Python session') });
					const metadata: positron.RuntimeSessionMetadata = { ...this.sessionMetadata, sessionId: `reticulate-python-${uuid.v4()}` };

					// When the R session is ready, we can start a new Reticulate session.
					this.pythonSession = this.createPythonRuntimeSession(
						this.runtimeMetadata,
						metadata,
						kernelSpec
					);

					this.progress.report({ increment: 50, message: vscode.l10n.t('Initializing the Python session') });

					try {
						await this.pythonSession.start();
					} catch (err: any) {
						vscode.window.showErrorMessage(vscode.l10n.t(
							'Failed to initialize and connect to the Reticulate Python session: {0}',
							err.message
						));
					}
				});

				// This should only happen once, so we dispose of this event as soon
				// as we have started reticulate.
				disposeListener.dispose();
			}
		});

		// We shutdown the python session to trigger the full behavior
		await this.pythonSession.shutdown(positron.RuntimeExitReason.Shutdown);
		return;
	}

	public async shutdown(exitReason: positron.RuntimeExitReason) {
		await this.pythonSession.shutdown(exitReason);
		positron.runtime.focusSession(this.rSession.metadata.sessionId);
		return;
	}

	public forceQuit() {
		// Force quit will kill the process, which also kills the R process.
		return this.pythonSession.forceQuit();
	}

	public listOutputChannels(): positron.LanguageRuntimeSessionChannel[] {
		return this.pythonSession.listOutputChannels?.() ?? [];
	}

	public showOutput(channel?: positron.LanguageRuntimeSessionChannel): void {
		this.pythonSession.showOutput?.(channel);
	}

	public dispose() {
		return this.pythonSession.dispose();
	}

	public updateSessionName(sessionName: string): void {
		this.pythonSession.updateSessionName(sessionName);
	}
}
class ReticulateRuntimeMetadata implements positron.LanguageRuntimeMetadata {
	extraRuntimeData: any = {
		pythonPath: 'Managed by the reticulate package',
		ipykernelBundle: {
			disabledReason: 'Cannot bundle ipykernel for reticulate sessions',
		},
		externallyManaged: true,
	};
	base64EncodedIconSvg: string | undefined;
	constructor() {
		this.base64EncodedIconSvg = fs
			.readFileSync(
				path.join(CONTEXT.extensionPath, 'resources', 'branding', 'reticulate.svg'),
				{ encoding: 'base64' }
			);
		// Check the kernel supervisor's configuration; if it's configured to
		// persist sessions, mark the session location as 'machine' so that
		// Positron will reattach to the session after Positron is
		// reopened.
		const config = vscode.workspace.getConfiguration('kernelSupervisor');
		this.sessionLocation =
			config.get<string>('shutdownTimeout', 'immediately') !== 'immediately' ?
				positron.LanguageRuntimeSessionLocation.Machine : positron.LanguageRuntimeSessionLocation.Workspace;

	}
	runtimePath: string = 'Managed by the reticulate package';
	runtimeName: string = 'Python (reticulate)';
	languageId: string = 'python';
	languageName: string = 'Python';
	runtimeId: string = 'reticulate';
	runtimeShortName: string = 'Python (reticulate)';
	runtimeVersion: string = '1.0';
	runtimeSource: string = 'reticulate';
	languageVersion = '1.0';
	startupBehavior: positron.LanguageRuntimeStartupBehavior = positron.LanguageRuntimeStartupBehavior.Manual;
	sessionLocation: positron.LanguageRuntimeSessionLocation = positron.LanguageRuntimeSessionLocation.Workspace;
}

export class ReticulateProvider {
	_client: positron.RuntimeClientInstance | undefined = undefined;
	manager: ReticulateRuntimeManager;
	registrationHook: vscode.Disposable | undefined;

	constructor(readonly context: vscode.ExtensionContext) {
		this.manager = new ReticulateRuntimeManager(this.context);
		this.context.subscriptions.push(positron.runtime.registerLanguageRuntimeManager('python', this.manager));
	}

	async registerClient(client: positron.RuntimeClientInstance, params: { input?: string; reticulate_id: string }) {
		// We get to this codepath when a user calls `reticulate::repl_python()` from the R session.
		LOGGER.info(`Registering reticulate client. reticulateId: ${params.reticulate_id}`,);

		// We'll force the registration when the user calls `reticulate::repl_python()`
		// even if the flag is not enabled.
		await this.manager.maybeRegisterReticulateRuntime();

		// Check if the manager knows about this reticulateId.
		const has_reticulate = this.manager.getSessions().find((tuple) => tuple.reticulateId === params.reticulate_id);
		let session: positron.LanguageRuntimeSession;
		if (!has_reticulate) {
			// This R sessions is unknown, we proceed to a normal initialization of the reticulate
			// session.
			session = await positron.runtime.startLanguageRuntime('reticulate', 'Python (reticulate)');
		} else {
			// The session already exists, so we just need to recover it from the manager
			const sess = this.manager._sessions.get(has_reticulate.reticulateSessionId);
			if (!sess) {
				throw new Error('Failed to find the session in the manager');
			}
			session = sess;
		}

		// Make sure we dispose the client when the session is gone
		session.onDidEndSession(() => {
			client.dispose();
		});

		// Handle the client events
		client.onDidSendEvent(async (e) => {
			const event = e.data as any;
			if (event.method === 'focus') {
				if (event.params && event.params.input) {
					session.execute(
						event.params.input,
						'reticulate-input',
						positron.RuntimeCodeExecutionMode.Interactive,
						positron.RuntimeErrorBehavior.Continue
					);
				}
				positron.runtime.focusSession(session.metadata.sessionId);
			}
		});

		// If the client is closed by the backend, something wrong happened, but there's
		// not much we can for now.
		client.onDidChangeClientState(
			(state: positron.RuntimeClientState) => {
				if (state === positron.RuntimeClientState.Closed) {
					LOGGER.error('Reticulate client closed by the back-end.');
				}
			}
		);

		if (params.input) {
			session.execute(
				params.input,
				'reticulate-input',
				positron.RuntimeCodeExecutionMode.Interactive,
				positron.RuntimeErrorBehavior.Continue
			);
		}

		positron.runtime.focusSession(session.metadata.sessionId);
	}

	dispose() {
		this._client?.dispose();
		this._client = undefined;
	}
}


let CONTEXT: vscode.ExtensionContext;
const LOGGER = vscode.window.createOutputChannel('Reticulate Extension', { log: true });
const autoEnabledStorageKey = 'positron.reticulate-auto-enabled';

/**
 * Activates the extension.
 *
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	CONTEXT = context;
	const reticulateProvider = new ReticulateProvider(context);

	context.subscriptions.push(
		positron.runtime.registerClientHandler({
			clientType: 'positron.reticulate',
			callback: (client, params: any) => {
				reticulateProvider.registerClient(client, params);
				return true;
			}
		}));

	context.subscriptions.push(
		vscode.commands.registerCommand('positron.reticulate.getIPykernelPath', () => {
			const api = vscode.extensions.getExtension('ms-python.python');
			if (!api) {
				throw new Error('Failed to find the Python extension API.');
			}
			return api.extensionPath + '/python_files/posit/positron';
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('positron.reticulate.isAutoEnabled', async () => {
			// Checks if reticulate is auto enabled.
			// This should only be called if positron.reticulate.enabled = auto
			return context.workspaceState.get<boolean>(autoEnabledStorageKey, false);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('positron.reticulate.setAutoEnabled', async () => {
			// This command is used to toggle the reticulate runtime enabled/disabled state
			await context.workspaceState.update(autoEnabledStorageKey, true);
			await reticulateProvider.manager.maybeRegisterReticulateRuntime();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('positron.reticulate.resetAutoEnabled', async () => {
			// This command is used to toggle the reticulate runtime enabled/disabled state
			await context.workspaceState.update(autoEnabledStorageKey, undefined);
		})
	);

	context.subscriptions.push(reticulateProvider);

	return reticulateProvider;
}
