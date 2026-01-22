/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { Action } from '../../../../base/common/actions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { localize } from '../../../../nls.js';
import {
	ILanguageRuntimeSession,
	IRuntimeSessionService,
	RuntimeStartMode,
} from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { timeout } from '../../../../base/common/async.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { POSITRON_QUARTO_INLINE_OUTPUT_KEY } from '../common/positronQuartoConfig.js';

export const IQuartoKernelManager = createDecorator<IQuartoKernelManager>('quartoKernelManager');

/**
 * Kernel state for a Quarto document.
 */
export enum QuartoKernelState {
	/** No kernel started */
	None = 'none',
	/** Kernel is starting */
	Starting = 'starting',
	/** Kernel is ready */
	Ready = 'ready',
	/** Kernel is busy executing code */
	Busy = 'busy',
	/** Kernel failed to start or crashed */
	Error = 'error',
	/** Kernel is shutting down */
	ShuttingDown = 'shuttingDown',
}

/**
 * Event emitted when kernel state changes.
 */
export interface QuartoKernelStateChangeEvent {
	readonly documentUri: URI;
	readonly oldState: QuartoKernelState;
	readonly newState: QuartoKernelState;
	readonly session?: ILanguageRuntimeSession;
}

/**
 * Interface for managing kernel sessions for Quarto documents.
 */
export interface IQuartoKernelManager {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when kernel state changes for a document.
	 */
	readonly onDidChangeKernelState: Event<QuartoKernelStateChangeEvent>;

	/**
	 * Get or start a kernel session for a qmd document.
	 * @param documentUri The URI of the Quarto document.
	 * @param token Optional cancellation token.
	 * @returns The session, or undefined if startup failed or was cancelled.
	 */
	ensureKernelForDocument(documentUri: URI, token?: CancellationToken): Promise<ILanguageRuntimeSession | undefined>;

	/**
	 * Get existing session without starting.
	 */
	getSessionForDocument(documentUri: URI): ILanguageRuntimeSession | undefined;

	/**
	 * Get the current kernel state for a document.
	 */
	getKernelState(documentUri: URI): QuartoKernelState;

	/**
	 * Shutdown kernel for a document.
	 */
	shutdownKernelForDocument(documentUri: URI): Promise<void>;

	/**
	 * Restart kernel for a document.
	 */
	restartKernelForDocument(documentUri: URI, token?: CancellationToken): Promise<ILanguageRuntimeSession | undefined>;

	/**
	 * Interrupt the kernel for a document.
	 */
	interruptKernelForDocument(documentUri: URI): void;
}

/**
 * Internal tracking info for a document's kernel session.
 */
interface DocumentKernelInfo {
	session: ILanguageRuntimeSession | undefined;
	state: QuartoKernelState;
	language: string | undefined;
	disposables: DisposableStore;
	startupCancellation: CancellationTokenSource | undefined;
}

/**
 * Implementation of the Quarto kernel manager.
 * Manages kernel sessions for Quarto documents, one session per document.
 */
export class QuartoKernelManager extends Disposable implements IQuartoKernelManager {
	declare readonly _serviceBrand: undefined;

	private readonly _documentKernels = new ResourceMap<DocumentKernelInfo>();

	/** Retry delays in milliseconds for exponential backoff */
	private readonly _retryDelays = [1000, 2000, 5000];

	private readonly _onDidChangeKernelState = this._register(new Emitter<QuartoKernelStateChangeEvent>());
	readonly onDidChangeKernelState = this._onDidChangeKernelState.event;

	constructor(
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IRuntimeStartupService private readonly _runtimeStartupService: IRuntimeStartupService,
		@IQuartoDocumentModelService private readonly _quartoDocumentModelService: IQuartoDocumentModelService,
		@IEditorService private readonly _editorService: IEditorService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();

		// Clean up sessions when documents are closed
		this._register(this._editorService.onDidCloseEditor(e => {
			const uri = e.editor.resource;
			if (uri && uri.path.endsWith('.qmd')) {
				// Delay cleanup slightly to handle editor tabs being moved
				setTimeout(() => {
					// Check if the document is still open in any editor
					const stillOpen = this._editorService.findEditors(uri).length > 0;
					if (!stillOpen) {
						this._logService.debug(`[QuartoKernelManager] Document closed, cleaning up: ${uri.toString()}`);
						this.shutdownKernelForDocument(uri);
					}
				}, 100);
			}
		}));

		// Shutdown all kernels when feature is disabled
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY)) {
				const enabled = this._configurationService.getValue<boolean>(POSITRON_QUARTO_INLINE_OUTPUT_KEY) ?? false;
				if (!enabled) {
					this._shutdownAllKernels();
				}
			}
		}));

		// Listen for runtime sessions starting (e.g., after window reload/restore)
		// This allows us to adopt sessions that were restored by the runtime session service
		this._register(this._runtimeSessionService.onDidStartRuntime(session => {
			const notebookUri = session.metadata.notebookUri;
			if (notebookUri && notebookUri.path.endsWith('.qmd')) {
				// Check if we're already tracking this session
				const existing = this._documentKernels.get(notebookUri);
				if (!existing || !existing.session) {
					this._logService.debug(`[QuartoKernelManager] Session started for Quarto document, adopting: ${notebookUri.toString()}`);
					this._tryAdoptExistingSession(notebookUri);
				}
			}
		}));
	}

	/**
	 * Shutdown all kernel sessions.
	 * Called when the feature flag is disabled.
	 */
	private async _shutdownAllKernels(): Promise<void> {
		this._logService.debug('[QuartoKernelManager] Shutting down all kernels (feature disabled)');

		const shutdownPromises: Promise<void>[] = [];
		for (const [uri] of this._documentKernels) {
			shutdownPromises.push(this.shutdownKernelForDocument(uri));
		}

		await Promise.allSettled(shutdownPromises);
	}

	/**
	 * Try to adopt an existing session from the runtime session service.
	 * This handles the case where a session was started before a window reload
	 * and we need to reconnect to it.
	 *
	 * @param documentUri The URI of the Quarto document.
	 * @returns The adopted session, or undefined if no existing session was found.
	 */
	private _tryAdoptExistingSession(documentUri: URI): ILanguageRuntimeSession | undefined {
		// Check if there's an existing session for this document in the runtime session service
		const existingSession = this._runtimeSessionService.getNotebookSessionForNotebookUri(documentUri);
		if (!existingSession) {
			return undefined;
		}

		// Check if the session is in a usable state
		const state = existingSession.getRuntimeState();
		if (state === RuntimeState.Exited || state === RuntimeState.Uninitialized) {
			return undefined;
		}

		this._logService.debug(`[QuartoKernelManager] Adopting existing session for ${documentUri.toString()}`);

		// Create tracking info for this session
		const info: DocumentKernelInfo = {
			session: existingSession,
			state: this._runtimeStateToKernelState(state),
			language: existingSession.runtimeMetadata.languageId,
			disposables: new DisposableStore(),
			startupCancellation: undefined,
		};

		this._documentKernels.set(documentUri, info);

		// Set up session event listeners
		this._setupSessionListeners(documentUri, existingSession, info);

		// Fire state change event so UI components update
		this._onDidChangeKernelState.fire({
			documentUri,
			oldState: QuartoKernelState.None,
			newState: info.state,
			session: existingSession,
		});

		return existingSession;
	}

	/**
	 * Convert a RuntimeState to a QuartoKernelState.
	 */
	private _runtimeStateToKernelState(runtimeState: RuntimeState): QuartoKernelState {
		switch (runtimeState) {
			case RuntimeState.Uninitialized:
			case RuntimeState.Initializing:
			case RuntimeState.Starting:
				return QuartoKernelState.Starting;
			case RuntimeState.Ready:
			case RuntimeState.Idle:
				return QuartoKernelState.Ready;
			case RuntimeState.Busy:
				return QuartoKernelState.Busy;
			case RuntimeState.Exiting:
			case RuntimeState.Offline:
			case RuntimeState.Interrupting:
			case RuntimeState.Restarting:
				return QuartoKernelState.ShuttingDown;
			case RuntimeState.Exited:
				return QuartoKernelState.None;
			default:
				return QuartoKernelState.None;
		}
	}

	async ensureKernelForDocument(
		documentUri: URI,
		token?: CancellationToken
	): Promise<ILanguageRuntimeSession | undefined> {
		// Check for existing session in our tracking
		const existing = this._documentKernels.get(documentUri);
		if (existing?.session) {
			const state = existing.session.getRuntimeState();
			// Return existing session if it's usable
			if (state !== RuntimeState.Exited && state !== RuntimeState.Uninitialized) {
				return existing.session;
			}
		}

		// Check if we're already starting
		if (existing?.state === QuartoKernelState.Starting) {
			this._logService.debug(`[QuartoKernelManager] Already starting kernel for ${documentUri.toString()}`);
			// Wait for the existing startup to complete
			return this._waitForKernelReady(documentUri, token);
		}

		// Check for existing session from runtime session service (e.g., after window reload)
		const adoptedSession = this._tryAdoptExistingSession(documentUri);
		if (adoptedSession) {
			const state = adoptedSession.getRuntimeState();
			if (state !== RuntimeState.Exited && state !== RuntimeState.Uninitialized) {
				return adoptedSession;
			}
		}

		// Start a new session with retry logic
		return this._startKernelWithRetry(documentUri, token);
	}

	getSessionForDocument(documentUri: URI): ILanguageRuntimeSession | undefined {
		// First check our tracked sessions
		const tracked = this._documentKernels.get(documentUri)?.session;
		if (tracked) {
			return tracked;
		}

		// Check for existing session from runtime session service (e.g., after window reload)
		const existingSession = this._tryAdoptExistingSession(documentUri);
		return existingSession;
	}

	getKernelState(documentUri: URI): QuartoKernelState {
		// First check our tracked sessions
		const tracked = this._documentKernels.get(documentUri);
		if (tracked) {
			return tracked.state;
		}

		// Check for existing session from runtime session service (e.g., after window reload)
		const existingSession = this._tryAdoptExistingSession(documentUri);
		if (existingSession) {
			// We just adopted the session, get the state from our tracking
			return this._documentKernels.get(documentUri)?.state ?? QuartoKernelState.None;
		}

		return QuartoKernelState.None;
	}

	async shutdownKernelForDocument(documentUri: URI): Promise<void> {
		const info = this._documentKernels.get(documentUri);
		if (!info) {
			return;
		}

		// Cancel any pending startup
		if (info.startupCancellation) {
			info.startupCancellation.cancel();
			info.startupCancellation.dispose();
			info.startupCancellation = undefined;
		}

		// Update state
		this._setKernelState(documentUri, QuartoKernelState.ShuttingDown);

		if (info.session) {
			try {
				await info.session.shutdown();
			} catch (error) {
				this._logService.warn(`[QuartoKernelManager] Error shutting down kernel: ${error}`);
			}
		}

		// Clean up
		info.disposables.dispose();
		this._documentKernels.delete(documentUri);
		this._setKernelState(documentUri, QuartoKernelState.None);
	}

	async restartKernelForDocument(
		documentUri: URI,
		token?: CancellationToken
	): Promise<ILanguageRuntimeSession | undefined> {
		const info = this._documentKernels.get(documentUri);
		if (info?.session) {
			const sessionId = info.session.sessionId;
			this._logService.debug(`[QuartoKernelManager] Restarting kernel for ${documentUri.toString()}`);
			await this._runtimeSessionService.restartSession(sessionId, 'Quarto kernel restart');
			return info.session;
		}

		// No existing session, start a new one
		return this.ensureKernelForDocument(documentUri, token);
	}

	interruptKernelForDocument(documentUri: URI): void {
		const info = this._documentKernels.get(documentUri);
		if (info?.session) {
			info.session.interrupt();
		}
	}

	/**
	 * Start a kernel with retry logic and exponential backoff.
	 */
	private async _startKernelWithRetry(
		documentUri: URI,
		token?: CancellationToken
	): Promise<ILanguageRuntimeSession | undefined> {
		let lastError: Error | undefined;

		for (let attempt = 0; attempt <= this._retryDelays.length; attempt++) {
			if (token?.isCancellationRequested) {
				this._logService.debug(`[QuartoKernelManager] Kernel startup cancelled for ${documentUri.toString()}`);
				return undefined;
			}

			try {
				const session = await this._startKernel(documentUri, token);
				if (session) {
					return session;
				}
				// Session is undefined but no error - language not found
				return undefined;
			} catch (error) {
				lastError = error as Error;
				this._logService.warn(
					`[QuartoKernelManager] Kernel start attempt ${attempt + 1} failed for ${documentUri.toString()}:`,
					error
				);

				if (attempt < this._retryDelays.length && !token?.isCancellationRequested) {
					const delay = this._retryDelays[attempt];
					this._logService.debug(`[QuartoKernelManager] Retrying in ${delay}ms...`);
					await timeout(delay);
				}
			}
		}

		// All retries exhausted
		this._setKernelState(documentUri, QuartoKernelState.Error);
		this._showKernelStartError(documentUri, lastError);
		return undefined;
	}

	/**
	 * Start a kernel session for a document.
	 */
	private async _startKernel(
		documentUri: URI,
		token?: CancellationToken
	): Promise<ILanguageRuntimeSession | undefined> {
		// Initialize or get document info
		let info = this._documentKernels.get(documentUri);
		if (!info) {
			info = {
				session: undefined,
				state: QuartoKernelState.None,
				language: undefined,
				disposables: new DisposableStore(),
				startupCancellation: undefined,
			};
			this._documentKernels.set(documentUri, info);
		}

		// Create a cancellation token source that combines the provided token with our own
		const cts = new CancellationTokenSource(token);
		info.startupCancellation = cts;

		// Update state to starting
		this._setKernelState(documentUri, QuartoKernelState.Starting);

		try {
			// Get the document's language from the Quarto document model
			const language = await this._getDocumentLanguage(documentUri);
			if (!language) {
				this._logService.warn(`[QuartoKernelManager] Could not determine language for ${documentUri.toString()}`);
				this._setKernelState(documentUri, QuartoKernelState.Error);
				this._notificationService.warn(
					localize('quartoKernel.noLanguage', "Could not determine language for Quarto document. Ensure the document has code cells with a language specified.")
				);
				return undefined;
			}

			if (cts.token.isCancellationRequested) {
				return undefined;
			}

			info.language = language;
			this._logService.debug(`[QuartoKernelManager] Starting ${language} kernel for ${documentUri.toString()}`);

			// Get preferred runtime for language
			const runtime = this._runtimeStartupService.getPreferredRuntime(language);
			if (!runtime) {
				this._logService.warn(`[QuartoKernelManager] No runtime found for language: ${language}`);
				this._setKernelState(documentUri, QuartoKernelState.Error);
				this._notificationService.warn(
					localize('quartoKernel.noRuntime', "No {0} runtime is available. Please install an interpreter for {0}.", language)
				);
				return undefined;
			}

			if (cts.token.isCancellationRequested) {
				return undefined;
			}

			// Start the session
			const sessionName = `Quarto: ${documentUri.path.split('/').pop()}`;
			const sessionId = await this._runtimeSessionService.startNewRuntimeSession(
				runtime.runtimeId,
				sessionName,
				LanguageRuntimeSessionMode.Notebook, // Use Notebook mode for Quarto documents
				documentUri,
				'Quarto inline output',
				RuntimeStartMode.Starting,
				false // don't activate in console
			);

			if (cts.token.isCancellationRequested) {
				// Cancel the session that was just started
				const session = this._runtimeSessionService.getSession(sessionId);
				if (session) {
					await session.shutdown();
				}
				return undefined;
			}

			const session = this._runtimeSessionService.getSession(sessionId);
			if (!session) {
				throw new Error('Session was created but could not be retrieved');
			}

			info.session = session;

			// Set up session event listeners
			this._setupSessionListeners(documentUri, session, info);

			// Wait for session to be ready
			await this._waitForSessionReady(session, cts.token);

			if (cts.token.isCancellationRequested) {
				await session.shutdown();
				return undefined;
			}

			this._setKernelState(documentUri, QuartoKernelState.Ready);
			this._logService.debug(`[QuartoKernelManager] Kernel ready for ${documentUri.toString()}`);

			return session;
		} catch (error) {
			if (cts.token.isCancellationRequested) {
				return undefined;
			}
			throw error;
		} finally {
			// Only clear the cancellation source if it's still the current one
			if (info.startupCancellation === cts) {
				info.startupCancellation = undefined;
			}
			cts.dispose();
		}
	}

	/**
	 * Set up listeners for session events.
	 */
	private _setupSessionListeners(
		documentUri: URI,
		session: ILanguageRuntimeSession,
		info: DocumentKernelInfo
	): void {
		// Listen for state changes
		info.disposables.add(session.onDidChangeRuntimeState(state => {
			this._handleSessionStateChange(documentUri, state, info);
		}));

		// Listen for session end
		info.disposables.add(session.onDidEndSession(() => {
			this._logService.debug(`[QuartoKernelManager] Session ended for ${documentUri.toString()}`);
			info.session = undefined;
			this._setKernelState(documentUri, QuartoKernelState.None);
		}));
	}

	/**
	 * Handle runtime state changes from the session.
	 */
	private _handleSessionStateChange(
		documentUri: URI,
		runtimeState: RuntimeState,
		info: DocumentKernelInfo
	): void {
		let kernelState: QuartoKernelState;

		switch (runtimeState) {
			case RuntimeState.Uninitialized:
			case RuntimeState.Initializing:
			case RuntimeState.Starting:
				kernelState = QuartoKernelState.Starting;
				break;
			case RuntimeState.Ready:
			case RuntimeState.Idle:
				kernelState = QuartoKernelState.Ready;
				break;
			case RuntimeState.Busy:
				kernelState = QuartoKernelState.Busy;
				break;
			case RuntimeState.Exiting:
			case RuntimeState.Offline:
			case RuntimeState.Interrupting:
			case RuntimeState.Restarting:
				kernelState = QuartoKernelState.ShuttingDown;
				break;
			case RuntimeState.Exited:
				kernelState = QuartoKernelState.None;
				break;
			default:
				kernelState = info.state;
		}

		if (kernelState !== info.state) {
			this._setKernelState(documentUri, kernelState);
		}
	}

	/**
	 * Wait for a session to become ready.
	 */
	private _waitForSessionReady(
		session: ILanguageRuntimeSession,
		token: CancellationToken
	): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const state = session.getRuntimeState();

			// Already ready
			if (state === RuntimeState.Ready || state === RuntimeState.Idle) {
				resolve();
				return;
			}

			// Already failed
			if (state === RuntimeState.Exited || state === RuntimeState.Offline) {
				reject(new Error('Session exited before becoming ready'));
				return;
			}

			const disposables = new DisposableStore();

			// Listen for state changes
			disposables.add(session.onDidChangeRuntimeState(newState => {
				if (newState === RuntimeState.Ready || newState === RuntimeState.Idle) {
					disposables.dispose();
					resolve();
				} else if (newState === RuntimeState.Exited || newState === RuntimeState.Offline) {
					disposables.dispose();
					reject(new Error('Session exited before becoming ready'));
				}
			}));

			// Listen for startup completion
			disposables.add(session.onDidCompleteStartup(() => {
				disposables.dispose();
				resolve();
			}));

			// Listen for startup failure
			disposables.add(session.onDidEncounterStartupFailure(failure => {
				disposables.dispose();
				reject(new Error(failure.message));
			}));

			// Handle cancellation
			disposables.add(token.onCancellationRequested(() => {
				disposables.dispose();
				reject(new Error('Kernel startup cancelled'));
			}));
		});
	}

	/**
	 * Wait for an existing kernel startup to complete.
	 */
	private async _waitForKernelReady(
		documentUri: URI,
		token?: CancellationToken
	): Promise<ILanguageRuntimeSession | undefined> {
		return new Promise<ILanguageRuntimeSession | undefined>((resolve) => {
			const checkState = () => {
				const info = this._documentKernels.get(documentUri);
				if (!info || info.state === QuartoKernelState.None || info.state === QuartoKernelState.Error) {
					resolve(undefined);
					return true;
				}
				if (info.state === QuartoKernelState.Ready || info.state === QuartoKernelState.Busy) {
					resolve(info.session);
					return true;
				}
				return false;
			};

			// Check immediately
			if (checkState()) {
				return;
			}

			// Listen for state changes
			const disposable = this.onDidChangeKernelState(e => {
				if (e.documentUri.toString() === documentUri.toString()) {
					if (checkState()) {
						disposable.dispose();
					}
				}
			});

			// Handle cancellation
			if (token) {
				token.onCancellationRequested(() => {
					disposable.dispose();
					resolve(undefined);
				});
			}
		});
	}

	/**
	 * Get the primary language for a Quarto document.
	 */
	private async _getDocumentLanguage(documentUri: URI): Promise<string | undefined> {
		// Find the text model for the document
		const editors = this._editorService.findEditors(documentUri);
		if (editors.length === 0) {
			return undefined;
		}

		// Try to get the text model from the editor input
		const editorInput = editors[0];
		const model = await editorInput.editor.resolve();
		if (!model || !('textEditorModel' in model)) {
			return undefined;
		}

		const textModel = model.textEditorModel as ITextModel;
		if (!textModel) {
			return undefined;
		}

		// Get the Quarto document model which parses the document
		const quartoModel = this._quartoDocumentModelService.getModel(textModel);
		return quartoModel.primaryLanguage;
	}

	/**
	 * Update kernel state and fire change event.
	 */
	private _setKernelState(documentUri: URI, newState: QuartoKernelState): void {
		const info = this._documentKernels.get(documentUri);
		const oldState = info?.state ?? QuartoKernelState.None;

		if (oldState === newState) {
			return;
		}

		if (info) {
			info.state = newState;
		}

		this._logService.trace(`[QuartoKernelManager] State change for ${documentUri.toString()}: ${oldState} -> ${newState}`);

		this._onDidChangeKernelState.fire({
			documentUri,
			oldState,
			newState,
			session: info?.session,
		});
	}

	/**
	 * Show an error notification for kernel startup failure.
	 */
	private _showKernelStartError(documentUri: URI, error: Error | undefined): void {
		const fileName = documentUri.path.split('/').pop();
		const message = error?.message || 'Unknown error';

		this._notificationService.notify({
			severity: Severity.Error,
			message: localize(
				'quartoKernel.startFailed',
				"Failed to start kernel for '{0}': {1}",
				fileName,
				message
			),
			actions: {
				primary: [
					new Action(
						'quartoKernel.retry',
						localize('quartoKernel.retry', "Retry"),
						undefined,
						true,
						() => {
							this.ensureKernelForDocument(documentUri);
							return Promise.resolve();
						}
					)
				]
			}
		});
	}

	override dispose(): void {
		// Shutdown all sessions
		for (const [, info] of this._documentKernels) {
			info.startupCancellation?.cancel();
			info.startupCancellation?.dispose();
			info.disposables.dispose();
			if (info.session) {
				Promise.resolve(info.session.shutdown()).catch((e: unknown) => {
					this._logService.warn(`[QuartoKernelManager] Error during disposal: ${e}`);
				});
			}
		}
		this._documentKernels.clear();
		super.dispose();
	}
}
