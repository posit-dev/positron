/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import * as perf from '../../../../base/common/performance.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IEphemeralStateService } from '../../../../platform/ephemeralState/common/ephemeralState.js';
import { IExtensionService } from '../../extensions/common/extensions.js';
import { IHostedLanguageContribution, ILanguageRuntimeExit, ILanguageRuntimeMetadata, ILanguageRuntimeService, IRuntimeManager, IRuntimeRootSignature, LanguageRuntimeArchitecture, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeExitReason, RuntimeStartupPhase, RuntimeState, LanguageStartupBehavior, formatLanguageRuntimeMetadata, signaturesEqual } from '../../languageRuntime/common/languageRuntimeService.js';
import { IRuntimeAutoStartEvent, IRuntimeStartupService, ISessionRestoreFailedEvent, SerializedSessionMetadata } from './runtimeStartupService.js';
import { IRuntimeDiscoveryCache, IRuntimeFingerprint, RUNTIME_DISCOVERY_CACHE_REFRESH_INTERVAL_DAYS_DEFAULT, RUNTIME_DISCOVERY_CACHE_REFRESH_INTERVAL_DAYS_SETTING } from './runtimeDiscoveryCacheService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService, RuntimeStartMode } from '../../runtimeSession/common/runtimeSessionService.js';
import { ExtensionsRegistry } from '../../extensions/common/extensionsRegistry.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILifecycleService, ShutdownReason } from '../../lifecycle/common/lifecycle.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IPositronNewFolderService } from '../../positronNewFolder/common/positronNewFolder.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import { isWeb } from '../../../../base/common/platform.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Barrier, Limiter, raceTimeout } from '../../../../base/common/async.js';
import { arch as systemArch } from '../../../../base/common/process.js';

interface ILanguageRuntimeProviderMetadata {
	languageId: string;
}

/** A queued background revalidation for a cache entry whose fingerprint changed. */
interface ICacheRevalidationTask {
	extensionId: string;
	languageId: string;
	metadata: ILanguageRuntimeMetadata;
	freshFingerprint: IRuntimeFingerprint;
}

/**
 * Discovery plan for a single ext host: which of its hosted language
 * contributions need to actually run discovery this pass, and which the
 * cache already covers and so should be filtered out of the ext-host's
 * discoverer loop.
 */
interface IManagerDiscoveryPlan {
	manager: IRuntimeManager;
	/**
	 * `(extensionId, languageId)` pairs whose discovery the ext host should
	 * run. Carries the full contribution so signature recording at discovery
	 * start can stamp the precise buckets being enumerated.
	 */
	runContributions: IHostedLanguageContribution[];
	/** Language IDs the ext host should NOT discover this pass (cache hit). */
	skipLanguageIds: string[];
}

/**
 * The serialization format for affiliated runtime metadata.
 */
interface IAffiliatedRuntimeMetadata {
	metadata: ILanguageRuntimeMetadata;
	lastUsed: number;
	lastStarted: number;
}

/**
 * Key for storing the set of persistent workspace session list.
 *
 * The session list is stored (by default) in ephemeral storage; this persists
 * across browser reloads/reconnects, but not across Positron sessions.
 *
 * Sessions can also be persisted across Positron sessions in workspace
 * storage, if the kernel supervisor is configured to do so.
 *
 * Amended with the workspace ID to allow for multiple workspaces to store their
 * sessions separately, and with a version number to allow for future changes to
 * the storage format.
 */
const PERSISTENT_WORKSPACE_SESSIONS = 'positron.workspaceSessionList.v3';

/**
 * Storage key for the count of runtimes registered at the end of the last
 * completed discovery pass. Used to drive a determinate progress bar in the
 * console "Discovering interpreters" UI.
 */
const LAST_DISCOVERY_RUNTIME_COUNT_KEY = 'positron.runtime.lastDiscoveryRuntimeCount';

const languageRuntimeExtPoint =
	ExtensionsRegistry.registerExtensionPoint<ILanguageRuntimeProviderMetadata[]>({
		extensionPoint: 'languageRuntimes',
		jsonSchema: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					languageId: {
						type: 'string',
						description: nls.localize('contributes.languageRuntime.languageId', 'The language ID for which this extension provides runtime services.'),
					}
				}
			}
		}
	});

export class RuntimeStartupService extends Disposable implements IRuntimeStartupService {

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	private readonly storageKey = 'positron.affiliatedRuntimeMetadata.v2';

	// The language packs; a map of language ID to a list of extensions that provide the language.
	private readonly _languagePacks: Map<string, Array<ExtensionIdentifier>> = new Map();

	// The set of encountered languages.
	private readonly _encounteredLanguagesByLanguageId = new Set<string>();

	// A map of most recently started runtimes. This is keyed by the languageId
	// (metadata.languageId) of the runtime.
	private readonly _mostRecentlyStartedRuntimesByLanguageId = new Map<string, ILanguageRuntimeMetadata>();

	// A map of each extension host and its runtime discovery completion state.
	// This is keyed by the the extension host's mainThreadLanguageRuntime's id
	// This map is used to determine if runtime discovery has been completed
	// across all extension hosts.
	private readonly _discoveryCompleteByExtHostId = new Map<number, boolean>();

	// The set of extensions that have already been activated. Used to avoid
	// redundant activation calls across the many code paths that can trigger
	// extension activation.
	private readonly _activatedExtensions = new Set<string>();

	// The current startup phase
	private _startupPhase: RuntimeStartupPhase;

	// Cached count of runtimes registered at the end of the last completed
	// discovery pass. Loaded from storage at construction; written when phase
	// transitions to Complete.
	private _lastDiscoveryRuntimeCount: number = 0;

	// Whether a background full-discovery / revalidation pass is currently
	// running. Tracked separately from `_startupPhase` because a background
	// pass can coexist with `Complete`: warm starts surface "ready for input"
	// before cache revalidation I/O has settled.
	private _backgroundDiscoveryInProgress = false;

	// Whether we are shutting down
	private _shuttingDown = false;

	/// The active set of runtime managers. Each represents an extension host
	/// running one or extensions that provide runtimes.
	private _runtimeManagers: IRuntimeManager[] = [];

	/// The event emitter for the onWillAutoStartRuntime event.
	private readonly _onWillAutoStartRuntime: Emitter<IRuntimeAutoStartEvent>;

	/// The event emitter for the onSessionRestoreFailure event.
	private readonly _onSessionRestoreFailure: Emitter<ISessionRestoreFailedEvent>;

	private _restoredSessions: SerializedSessionMetadata[] = [];
	private _foundRestoredSessions: Barrier = new Barrier();

	/// Tracks whether the first runtime has reached ready state
	private _firstRuntimeReady = false;

	/// A unique identifier for this window. This is used to identify the
	/// persisted sessions that belong to it.
	private _localWindowId: string;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEphemeralStateService private readonly _ephemeralStateService: IEphemeralStateService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IPositronNewFolderService private readonly _newFolderService: IPositronNewFolderService,
		@IProgressService private readonly _progressService: IProgressService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IRuntimeDiscoveryCache private readonly _discoveryCache: IRuntimeDiscoveryCache,
	) {

		super();

		perf.mark('code/positron/runtimeStartupBegin');

		this._onWillAutoStartRuntime = new Emitter<IRuntimeAutoStartEvent>();
		this._onSessionRestoreFailure = new Emitter<ISessionRestoreFailedEvent>();
		this._register(this._onSessionRestoreFailure);
		this._register(this._onWillAutoStartRuntime);
		this.onWillAutoStartRuntime = this._onWillAutoStartRuntime.event;
		this.onSessionRestoreFailure = this._onSessionRestoreFailure.event;

		// Generate a short (8 character) random hex string to use as a unique
		// identifier for this window.
		this._localWindowId = `window-${Math.random().toString(16).substring(2, 10)}`;

		this._register(
			this._runtimeSessionService.onDidChangeForegroundSession(
				this.onDidChangeActiveRuntime, this));

		this._register(
			this._languageRuntimeService.onDidRegisterRuntime(
				this.onDidRegisterRuntime, this));

		this._startupPhase = _languageRuntimeService.startupPhase;
		perf.mark(`code/positron/runtimeStartupPhase/${this._startupPhase}`);

		this._lastDiscoveryRuntimeCount = this._storageService.getNumber(
			LAST_DISCOVERY_RUNTIME_COUNT_KEY, StorageScope.APPLICATION, 0);
		this._register(
			this._languageRuntimeService.onDidChangeRuntimeStartupPhase(
				(phase) => {
					this._logService.debug(`[Runtime startup] Phase changed to '${phase}'`);
					if (this._startupPhase !== phase) {
						this._startupPhase = phase;
						perf.mark(`code/positron/runtimeStartupPhase/${phase}`);
					}
				}));


		this._register(this._runtimeSessionService.onWillStartSession(e => {
			this._register(e.session.onDidEncounterStartupFailure(_exit => {
				// Update the set of workspace sessions, removing the one that
				// failed to start.
				this.saveWorkspaceSessions(e.session.metadata.sessionId);
			}));
			perf.mark(`code/positron/runtimeSessionWillStart/${e.session.sessionId}`);
		}));

		this._register(this._runtimeSessionService.onDidFailStartRuntime(e => {
			// Update the set of workspace sessions
			this.saveWorkspaceSessions(e.sessionId);
		}));

		// Listen for runtime start events and update the most recently started
		// runtimes for each language.
		this._register(this._runtimeSessionService.onDidStartRuntime(session => {

			this._mostRecentlyStartedRuntimesByLanguageId.set(session.runtimeMetadata.languageId,
				session.runtimeMetadata);

			// Track session start time for diagnostics
			perf.mark(`code/positron/runtimeSessionStart/${session.sessionId}`);

			// Track when the first runtime reaches ready state
			if (!this._firstRuntimeReady) {
				// Check current state immediately (important for reconnected sessions
				// that may already be in Ready state)
				if (session.getRuntimeState() === RuntimeState.Ready) {
					this._firstRuntimeReady = true;
					perf.mark('code/positron/firstRuntimeReady');
				} else {
					// Listen for future state changes; dispose the listener
					// once the first runtime is ready to avoid accumulating
					// listeners across sessions.
					const listener = session.onDidChangeRuntimeState((newState) => {
						if (!this._firstRuntimeReady && newState === RuntimeState.Ready) {
							this._firstRuntimeReady = true;
							perf.mark('code/positron/firstRuntimeReady');
						}
						if (this._firstRuntimeReady) {
							listener.dispose();
						}
					});
					this._register(listener);
				}
			}

			this.saveWorkspaceSessions();

			// Check for architecture mismatch now that the session has started.
			// runtimeInfo is available after session.start() completes.
			if (session.runtimeInfo) {
				this.checkArchitectureMismatch(session, session.runtimeInfo);
			}

			this._register(session.onDidEndSession(exit => {
				// Ignore if shutting down; sessions 'exit' during shutdown as
				// they disconnect from the extension host.
				if (this._shuttingDown) {
					return;
				}

				// Ignore when sessions "exited" due to being transferred or restarted.
				if (exit.reason === RuntimeExitReason.Transferred ||
					exit.reason === RuntimeExitReason.Restart) {
					return;
				}

				// Update the set of workspace sessions
				this.saveWorkspaceSessions(session.metadata.sessionId);

				if (exit.reason === RuntimeExitReason.Error) {
					// Restart after a crash, if necessary
					this.restartAfterCrash(session, exit);
				}
			}));
		}));

		// When the discovery phase is complete, check to see if we need to
		// auto-start a runtime.
		this._register(this._languageRuntimeService.onDidChangeRuntimeStartupPhase(phase => {
			if (phase === RuntimeStartupPhase.Complete) {

				// Persist the count of registered runtimes so the next session
				// can show a determinate progress bar during discovery.
				const count = this._languageRuntimeService.registeredRuntimes.length;
				if (count > 0 && count !== this._lastDiscoveryRuntimeCount) {
					this._lastDiscoveryRuntimeCount = count;
					this._storageService.store(LAST_DISCOVERY_RUNTIME_COUNT_KEY, count,
						StorageScope.APPLICATION, StorageTarget.MACHINE);
				}

				// Check to see if every single language runtime has been disabled.
				const languageIds = this._languagePacks.keys();
				let allDisabled = true;
				for (const languageId of languageIds) {
					if (this.getStartupBehavior(languageId) !== LanguageStartupBehavior.Disabled) {
						allDisabled = false;
						break;
					}
				}

				// If there are no runtimes registered, but it isn't because
				// everything was disabled, show an error.
				if (this._languageRuntimeService.registeredRuntimes.length === 0 &&
					!allDisabled) {
					this._notificationService.error(nls.localize('positron.runtimeStartupService.noRuntimesMessage',
						"No interpreters found. Please see the [Get Started](https://positron.posit.co/start) \
						documentation to learn how to prepare your Python and/or R environments to work with Positron."));
				}

				// If there are no affiliated runtimes, and no starting or running
				// runtimes, start the first runtime that has Immediate startup
				// behavior.
				else if (!this.hasAffiliatedRuntime() &&
					!this._runtimeSessionService.hasStartingOrRunningConsole()) {
					const languageRuntimes = this._languageRuntimeService.registeredRuntimes
						.filter(metadata => {
							// Filter out runtimes that don't have immediate
							// startup behavior
							return metadata.startupBehavior === LanguageRuntimeStartupBehavior.Immediate;
						})
						.filter(metadata => {
							// Filter out runtimes that don't auto-start
							const startupBehavior = this.getStartupBehavior(metadata.languageId);
							return startupBehavior !== LanguageStartupBehavior.Disabled &&
								startupBehavior !== LanguageStartupBehavior.Manual;
						});

					// Start the first runtime that has Immediate startup behavior
					if (languageRuntimes.length) {
						const extension = languageRuntimes[0].extensionId;
						this.autoStartRuntime(languageRuntimes[0],
							`The ${extension.value} extension requested the runtime to be started immediately.`,
							true);
						return;
					}

					// Okay, no immediate startup runtimes found. Let's try to start
					// runtimes for any languages that are marked to start Always.
					let languageId = '';
					const alwaysStarted = this._languageRuntimeService.registeredRuntimes
						.filter(metadata => {
							// Only one language ID can be auto-started. If
							// there are multiple, only the first is started.
							if (languageId !== '') {
								return false;
							}

							// Consider: This has fallback behavior that can be
							// counterintuitive. The configuration service
							// looks up a global value if it can't find a
							// language-specific value. So if you set 'Always'
							// as the global default, it will make every
							// language start. This is probably not what is
							// desired.
							const always = this.getStartupBehavior(metadata.languageId) === LanguageStartupBehavior.Always;
							if (always) {
								languageId = metadata.languageId;
							}
							return always;
						});
					if (alwaysStarted.length) {
						this.autoStartRuntime(alwaysStarted[0],
							`The configuration specifies that a runtime should always start for the '${languageId}' language.`,
							true);
					}
				}
			}
		}));

		// Add the onDidEncounterLanguage event handler.
		this._register(this._languageService.onDidRequestRichLanguageFeatures(languageId => {
			// Add the language to the set of encountered languages.
			this._encounteredLanguagesByLanguageId.add(languageId);
		}));

		// When a runtime is registered, check to see if we need to auto-start it.
		this._register(this._languageRuntimeService.onDidRegisterRuntime(runtime => {
			// Automatically start the language runtime under the following conditions:
			// - The language runtime wants to start immediately.
			// - No other runtime is currently running.
			// - We have completed the discovery phase of the language runtime
			//   registration process.
			if (runtime.startupBehavior === LanguageRuntimeStartupBehavior.Immediate &&
				this._startupPhase === RuntimeStartupPhase.Complete &&
				!this._runtimeSessionService.hasStartingOrRunningConsole()) {

				this.autoStartRuntime(runtime,
					`An extension requested that the runtime start immediately after being registered.`, true);
			}

			// Automatically start the language runtime under the following conditions:
			// - We have encountered the language that the runtime serves.
			// - We have completed the discovery phase of the language runtime
			//   registration process.
			// - The runtime is not already starting or running.
			// - The runtime has implicit startup behavior.
			// - There's no runtime affiliated with the current workspace for this
			//   language (if there is, we want that runtime to start, not this one)
			// - Implicit startup is not suppressed (e.g. during new folder init)
			else if (this._encounteredLanguagesByLanguageId.has(runtime.languageId) &&
				this._startupPhase === RuntimeStartupPhase.Complete &&
				!this._runtimeSessionService.hasStartingOrRunningConsole(runtime.languageId) &&
				runtime.startupBehavior === LanguageRuntimeStartupBehavior.Implicit &&
				!this.getAffiliatedRuntimeMetadata(runtime.languageId) &&
				!this._runtimeSessionService.implicitStartupSuppressed) {

				this.autoStartRuntime(runtime,
					`A file with the language ID ${runtime.languageId} was open ` +
					`when the runtime was registered.`, true);
			}
		}));

		this._register(languageRuntimeExtPoint.setHandler((extensions) => {
			// This new set of extensions replaces the old set, so clear the
			// language packs.
			this._languagePacks.clear();

			// Loop over each extension that contributes language runtimes.
			for (const extension of extensions) {
				for (const value of extension.value) {
					this._logService.debug(`[Runtime startup] Extension ${extension.description.identifier.value} has been registered for language runtime for language ID '${value.languageId}'`);
					if (this._languagePacks.has(value.languageId)) {
						this._languagePacks.get(value.languageId)?.push(extension.description.identifier);
					} else {
						this._languagePacks.set(value.languageId, [extension.description.identifier]);
					}
				}
			}

			// If we were awaiting trust, and we now have language packs, the
			// workspace has been trusted and extensions have been activated.
			// Run the full startup sequence (not just discovery) so that
			// session restoration, affiliated runtimes, etc. are handled.
			if (this._startupPhase === RuntimeStartupPhase.AwaitingTrust) {
				if (this._languagePacks.size > 0) {
					this.startupSequence();
				} else {
					this._logService.debug(`[Runtime startup] No language packs were found.`);
					this.setStartupPhase(RuntimeStartupPhase.Complete);
				}
			} else if (this._startupPhase === RuntimeStartupPhase.Initializing && this._languagePacks.size > 0) {
				// If we just got language packs, and we were in the Initializing
				// phase, move on to the startup phase.
				this.startupAfterTrust();
			}
		}));

		// This handler is required so session names persist
		// across browser reloads. Workspace session data is
		// saved before a shutdown, but this solution doesn't
		// work for web builds because async shutdown operations
		// aren't supported and trigger browser warnings.
		// As a workaround, we save the workspace sessions
		// whenever a session name is updated.
		//
		this._register(this._runtimeSessionService.onDidUpdateSessionName(() => {
			// Update the set of workspace sessions
			this.saveWorkspaceSessions();
		}));

		// Register a shutdown event handler so that we have a chance to save
		// state before a reload.
		this._register(this._lifecycleService.onBeforeShutdown((e) => {
			// Mark that we are shutting down
			this._shuttingDown = true;
			if (e.reason === ShutdownReason.RELOAD) {
				// Attempt to save the current state of the workspace sessions
				// before reloading the browser.
				e.veto(this.saveWorkspaceSessions(),
					'positron.runtimeStartup.saveWorkspaceSessions');
			} else {
				// Clear the workspace sessions. In most cases this is not
				// necessary since the sessions are stored in ephemeral
				// storage, but it is possible that this workspace will be
				// re-opened without an interleaving quit (e.g. if multiple
				// Positron windows are open).
				//
				// We don't do this in web mode because async shutdown
				// operations aren't supported on the web, and if used will
				// trigger a browser warning when the user attempts to navigate
				// away.
				if (!isWeb) {
					e.veto(this.clearWorkspaceSessions(),
						'positron.runtimeStartup.clearWorkspaceSessions');
				}
			}
		}));

		// If the workspace is not trusted, transition to the AwaitingTrust
		// phase so the console shows the correct message (rather than "Waiting
		// for extensions", which is misleading since extensions won't activate
		// until the workspace is trusted).
		//
		// Wait for workspace trust to finish initializing before checking. All
		// workspaces now open in an untrusted state and may transition to
		// trusted during startup (e.g. once canonical URIs are resolved), so
		// checking synchronously here would briefly show the misleading
		// "Restricted Mode" message for workspaces that are actually trusted.
		this._workspaceTrustManagementService.workspaceTrustInitialized.then(() => {
			if (this._startupPhase === RuntimeStartupPhase.Initializing &&
				!this._workspaceTrustManagementService.isWorkspaceTrusted()) {
				this.setStartupPhase(RuntimeStartupPhase.AwaitingTrust);
			}
		});

		// Find all the sessions that need to be restored.
		this.findRestoredSessions().then(() => {
			this._logService.trace(
				`[Runtime startup] Found ${this._restoredSessions.length} restored sessions.`);
		}).finally(() => {
			this._foundRestoredSessions.open();
		});
	}

	onWillAutoStartRuntime: Event<IRuntimeAutoStartEvent>;

	onSessionRestoreFailure: Event<ISessionRestoreFailedEvent>;

	public get startupPhase(): RuntimeStartupPhase {
		return this._startupPhase;
	}

	public get backgroundDiscoveryInProgress(): boolean {
		return this._backgroundDiscoveryInProgress;
	}

	public get lastDiscoveryRuntimeCount(): number {
		return this._lastDiscoveryRuntimeCount;
	}

	/**
	 * Gets all the affiliated runtimes for the workspace.
	 *
	 * @returns An array of affiliated runtime metadata. May be empty if no
	 * runtimes are affiliated.
	 */
	getAffiliatedRuntimes(): Array<ILanguageRuntimeMetadata> {
		const languageIds = this.getAffiliatedRuntimeLanguageIds();
		const runtimes: ILanguageRuntimeMetadata[] = [];
		for (const languageId of languageIds) {
			const metadata = this.getAffiliatedRuntimeMetadata(languageId);
			if (metadata) {
				runtimes.push(metadata);
			}
		}
		return runtimes;
	}

	/**
	 * Clears a specific runtime from the list of affiliated runtimes.
	 *
	 * @param languageId The language ID of the runtime to clear.
	 */
	clearAffiliatedRuntime(languageId: string): void {
		this._storageService.remove(`${this.storageKey}.${languageId}`, this.affiliationStorageScope());
		this._logService.debug(`[Runtime startup] Cleared affiliated runtime for language ID '${languageId}'`);
	}

	/**
	 * Convenience method for setting the startup phase.
	 */
	private setStartupPhase(phase: RuntimeStartupPhase): void {
		const newPhase = this._startupPhase !== phase;
		this._startupPhase = phase;
		this._languageRuntimeService.setStartupPhase(phase);
		if (newPhase) {
			perf.mark(`code/positron/runtimeStartupPhase/${phase}`);
		}
	}

	/**
	 * Finds and populates the set of sessions that need to be restored.
	 */
	private async findRestoredSessions() {
		// Get the set of sessions that were active when the workspace was last open.
		let storedSessions: Array<SerializedSessionMetadata> = new Array();
		try {
			const sessions =
				await this._ephemeralStateService.getItem<Array<SerializedSessionMetadata>>(
					this.getEphemeralWorkspaceSessionsKey());
			if (sessions) {
				storedSessions = sessions;
			}
		} catch (err) {
			this._logService.warn(`Can't read workspace sessions from ${this.getEphemeralWorkspaceSessionsKey()}: ${err}. No sessions will be restored.`);
		}

		if (!storedSessions) {
			this._logService.debug(`[Runtime startup] No sessions to resume found in ephemeral storage.`);
		}

		// Next, check for any sessions persisted in the workspace storage.
		const sessions = this._storageService.get(PERSISTENT_WORKSPACE_SESSIONS,
			this.getPersistentSessionStorageScope());
		if (sessions) {
			try {
				const stored = JSON.parse(sessions) as Array<SerializedSessionMetadata>;
				storedSessions.push(...stored);
			} catch (err) {
				this._logService.error(`Error parsing persisted workspace sessions: ${err} (sessions: '${sessions}')`);
			}
		}

		try {
			// Revive the URIs in the session metadata.
			this._restoredSessions = storedSessions.map(session => ({
				...session,
				metadata: {
					...session.metadata,
					notebookUri: URI.revive(session.metadata.notebookUri),
				},
			}));
		} catch (err) {
			this._logService.error(`Could not restore workspace sessions: ${err?.stack ?? err} ` +
				`(data: ${JSON.stringify(storedSessions)})`);
		}

		// Sort the sessions by last used time, descending, so that the most recently used
		// sessions are at the top.
		this._restoredSessions.sort((a, b) => b.lastUsed - a.lastUsed);
	}

	/**
	 * Gets sessions that should be restored in the workspace.
	 *
	 * @returns A list of sessions that should be restored.
	 */
	public async getRestoredSessions(): Promise<SerializedSessionMetadata[]> {
		await this._foundRestoredSessions.wait();
		return this._restoredSessions;
	}

	/**
	 * The main entry point for the runtime startup service.
	 */
	private async startupSequence() {

		// Guard against double entry. Multiple code paths can call
		// startupSequence() (e.g. the ext-point handler and
		// startupAfterTrust). Setting the phase synchronously before
		// the first await ensures only the first caller proceeds.
		if (this._startupPhase !== RuntimeStartupPhase.AwaitingTrust &&
			this._startupPhase !== RuntimeStartupPhase.Initializing) {
			return;
		}
		this.setStartupPhase(RuntimeStartupPhase.Starting);

		// Attempt to reconnect to any active sessions first.
		await this.restoreSessions();

		// If this is a new folder, wait for it to initialize the folder
		// before proceeding, and then store the new folder runtime metadata.
		// as the affiliated runtime for this workspace.
		if (!this._newFolderService.initTasksComplete.isOpen()) {
			perf.mark('code/positron/newFolderInitTasks');
			this.setStartupPhase(RuntimeStartupPhase.NewFolderTasks);
			await this._newFolderService.initTasksComplete.wait();
			const newRuntime = this._newFolderService.newFolderRuntimeMetadata;
			if (newRuntime) {
				const newAffiliation: IAffiliatedRuntimeMetadata = {
					metadata: newRuntime,
					lastUsed: Date.now(),
					lastStarted: Date.now()
				};
				this.saveAffiliatedRuntime(newAffiliation);
			}
		}

		const disabledLanguages = new Array<string>();
		const enabledLanguages = Array.from(this._languagePacks.keys()).filter(languageId => {
			if (this.getStartupBehavior(languageId) === LanguageStartupBehavior.Disabled) {
				this._logService.debug(`[Runtime startup] Skipping language runtime startup for language ID '${languageId}' because its startup behavior is disabled.`);
				disabledLanguages.push(languageId);
				return false;
			}
			return true;
		});

		this.setStartupPhase(RuntimeStartupPhase.Starting);

		// If no sessions were restored, and we have affiliated runtimes,
		// try to start them.
		try {
			if (!this._runtimeSessionService.hasStartingOrRunningConsole() &&
				this.hasAffiliatedRuntime()) {
				await this.startAffiliatedLanguageRuntimes(disabledLanguages, enabledLanguages);
			}

			// Start any runtimes recommended by the extensions.
			if (!this._runtimeSessionService.hasStartingOrRunningConsole()) {
				await this.startRecommendedLanguageRuntimes(disabledLanguages, enabledLanguages);
			}
		} catch (err) {
			this._logService.error(`[Runtime startup] Error starting affiliated runtimes: ${err}`);
		}

		// Then, discover all language runtimes.
		await this.discoverAllRuntimes();
	}

	/**
	 * Saves a runtime affiliation to workspace storage.
	 *
	 * @param affiliated The runtime affiliation to save.
	 */
	private saveAffiliatedRuntime(affiliated: IAffiliatedRuntimeMetadata): void {

		if (!affiliated || !affiliated.metadata || !affiliated.metadata.languageId) {
			// Don't save invalid affiliations
			this._logService.debug(`[Runtime startup] Not saving invalid affiliation ${JSON.stringify(affiliated)}.`);
			return;
		}

		this._storageService.store(this.storageKeyForRuntime(affiliated.metadata),
			JSON.stringify(affiliated),
			this.affiliationStorageScope(),
			StorageTarget.MACHINE);
	}

	/**
	 * Signals that the runtime discovery phase is completed only after all
	 * extension hosts have completed runtime discovery.
	 *
	 * If no runtimes were started or will be started, automatically start one.
	 */
	public completeDiscovery(id: number): void {
		// Update the extension host's runtime discovery state to 'Complete'
		this._discoveryCompleteByExtHostId.set(id, true);
		this._logService.debug(`[Runtime startup] Discovery completed for extension host with id: ${id}.`);

		// Determine if all extension hosts have completed discovery
		let discoveryCompletedByAllExtensionHosts = true;
		for (const disoveryCompleted of this._discoveryCompleteByExtHostId.values()) {
			if (!disoveryCompleted) {
				discoveryCompletedByAllExtensionHosts = false;
				break;
			}
		}

		// The 'Discovery' phase is considered complete only after all extension hosts
		// have signaled they have completed their own runtime discovery
		if (discoveryCompletedByAllExtensionHosts) {
			this.setStartupPhase(RuntimeStartupPhase.Complete);
			// Reset the discovery state for each ext host so we are ready
			// for possible re-discovery of runtimes
			this._discoveryCompleteByExtHostId.forEach((_, extHostId, m) => {
				m.set(extHostId, false);
			});
		}
	}

	/**
	 * Used to register an instance of a MainThreadLanguageRuntime.
	 *
	 * This is required because there can be multiple extension hosts
	 * and the startup service needs to know of all of them to track
	 * the startup phase across all extension hosts.
	 *
	 * @param id The id of the MainThreadLanguageRuntime instance being registered.
	 */
	public registerRuntimeManager(manager: IRuntimeManager): IDisposable {
		// Add the mainThreadLanguageRuntime instance id to the set of mainThreadLanguageRuntimes.
		this._discoveryCompleteByExtHostId.set(manager.id, false);
		this._runtimeManagers.push(manager);
		this._logService.debug(`[Runtime startup] Registered runtime manager (ext host) with id: ${manager.id}.`);

		return {
			dispose: () => {
				const index = this._runtimeManagers.indexOf(manager);
				if (index !== -1) {
					this._runtimeManagers.splice(index, 1);
				}
			}
		};
	}

	/**
	 * Kicks off a refresh of runtime discovery, after initial discovery.
	 *
	 * Bypasses the discovery cache: every manager runs a fresh full pass and
	 * the resulting `cacheable: true` metadata re-seeds the cache. Refuses to
	 * run if a background revalidation pass is already in flight, since
	 * `Complete` can coexist with one and we want to avoid a second concurrent
	 * pass racing against it.
	 */
	public async rediscoverAllRuntimes(quiet?: boolean): Promise<void> {

		// If we haven't completed discovery once already, don't do anything.
		if (this._startupPhase !== RuntimeStartupPhase.Complete) {
			this._logService.warn('[Runtime startup] Runtime discovery refresh called before initial discovery is complete.');
			return;
		}

		// Refuse if a background full / revalidation pass is already running.
		// Notify the user rather than silently no-op'ing so it's clear why
		// the command appeared to do nothing.
		if (this._backgroundDiscoveryInProgress) {
			this._logService.info('[Runtime startup] Runtime discovery refresh skipped: a background pass is already in progress.');
			this._notificationService.info(nls.localize('positron.runtimeStartupService.discoveryAlreadyRunning',
				"Interpreter discovery is already running in the background; please wait for it to finish."));
			return;
		}

		// Remember the old set of runtimes so we can report any new ones
		const oldRuntimes = this._languageRuntimeService.registeredRuntimes;
		this._logService.debug('[Runtime startup] Refreshing runtime discovery (bypassing cache).');
		this._discoveryCompleteByExtHostId.forEach((_, extHostId, m) => {
			m.set(extHostId, false);
		});

		// Start progress for the discovery process
		await this._progressService.withProgress({
			location: ProgressLocation.Notification,
			title: nls.localize('positron.runtimeStartupService.discoveringRuntimes', 'Discovering interpreters...'),
			cancellable: false
		}, async (progress) => {
			// Start the discovery process. bypassCache=true so every manager
			// runs a fresh full pass and the cache is re-seeded from the
			// results via onDidRegisterRuntime's cache-write path.
			this.discoverAllRuntimes({ bypassCache: true });

			// Wait for discovery to complete
			await new Promise<void>((resolve) => {
				const disposable = this._languageRuntimeService.onDidChangeRuntimeStartupPhase(phase => {
					if (phase === RuntimeStartupPhase.Complete) {
						if (!quiet) {
							const newRuntimes = this._languageRuntimeService.registeredRuntimes;
							const addedRuntimes = newRuntimes.filter(newRuntime => {
								return !oldRuntimes.some(oldRuntime => {
									return oldRuntime.runtimeId === newRuntime.runtimeId;
								});
							});
							if (addedRuntimes.length > 0) {
								this._notificationService.info(nls.localize('positron.runtimeStartupService.runtimesAddedMessage',
									"Found {0} new interpreter{1}: {2}.",
									addedRuntimes.length,
									addedRuntimes.length > 1 ? 's' : '',
									addedRuntimes.map(runtime => { return runtime.runtimeName; }).join(', ')));
							} else {
								this._notificationService.info(nls.localize('positron.runtimeStartupService.noNewRuntimesMessage',
									"No new interpreters found."));
							}
						}
						resolve();
						disposable.dispose();
					}
				});
			});
		});
	}

	/**
	 * Runs as an event handler when the active runtime changes.
	 *
	 * @param runtime The newly active runtime, or undefined if no runtime is active.
	 */
	private onDidChangeActiveRuntime(session: ILanguageRuntimeSession | undefined): void {
		// Ignore if we are entering a state in which no runtime is active.
		if (!session) {
			return;
		}

		if (session.runtimeMetadata.startupBehavior === LanguageRuntimeStartupBehavior.Manual) {
			return;
		}

		// Get the previous affiliation, if any, to preserve the start time.
		const oldAffiliation = this.getAffiliatedRuntime(session.runtimeMetadata.languageId);
		const lastStarted =
			oldAffiliation?.metadata.runtimeId === session.runtimeMetadata.runtimeId ?
				oldAffiliation.lastStarted :
				Date.now();

		// Save this runtime as the affiliated runtime for the current workspace.
		const affiliated: IAffiliatedRuntimeMetadata = {
			metadata: session.runtimeMetadata,
			lastUsed: Date.now(),
			lastStarted
		};
		this.saveAffiliatedRuntime(affiliated);

		// If the runtime is exiting, remove the affiliation if it enters the
		// `Exiting` state. This state only occurs when the runtime is manually
		// shut down, so may represent a user's intent to stop using the runtime
		// for this workspace.
		this._register(session.onDidChangeRuntimeState((newState) => {
			if (newState === RuntimeState.Exiting) {
				// Just to be safe, check that the runtime is still affiliated
				// before removing the affiliation
				const serializedMetadata = this._storageService.get(
					this.storageKeyForRuntime(session.runtimeMetadata),
					this.affiliationStorageScope());
				if (!serializedMetadata) {
					return;
				}
				const affiliated = JSON.parse(serializedMetadata) as IAffiliatedRuntimeMetadata;
				const affiliatedRuntimeId = affiliated.metadata.runtimeId;
				if (session.runtimeMetadata.runtimeId === affiliatedRuntimeId) {
					// Remove the affiliation
					this._storageService.remove(this.storageKeyForRuntime(session.runtimeMetadata),
						this.affiliationStorageScope());
				}
			}
		}));
	}

	/**
	 * Activates all extensions that contribute runtimes, then runs cache-aware
	 * discovery: load survivors from the cross-window cache (LoadingCache),
	 * decide which managers still need a real enumeration (Discovering), and
	 * kick off background revalidation for entries whose fingerprint changed.
	 *
	 * @param options.bypassCache When true, skips the cache foreground pass
	 * and forces full discovery for every manager. Used by user-triggered
	 * "Discover All Interpreters" so the cache is always re-seeded from a
	 * fresh ground truth.
	 */
	private async discoverAllRuntimes(options: { bypassCache?: boolean } = {}) {

		// If we have no language packs yet, but were awaiting trust, we need to
		// wait until the language packs are reloaded with the new trust
		// settings before we can continue.
		if (this._startupPhase === RuntimeStartupPhase.AwaitingTrust &&
			this._languagePacks.size === 0) {

			// Wait up to 5 seconds for the language packs to be reloaded;
			// this should be very fast since it just requires the extension
			// host to scan the package JSON files of the extensions. If after 5
			// seconds we still don't have any language packs, there's no more
			// work to do; mark as complete so we don't hang in the
			// AwaitingTrust phase forever.
			setTimeout(() => {
				if (this._startupPhase === RuntimeStartupPhase.AwaitingTrust) {
					this.setStartupPhase(RuntimeStartupPhase.Complete);
				}
			}, 5000);
			return;
		}

		// Filter out any language packs that are disabled.
		const disabledLanguages = new Array<string>();
		const enabledLanguages = Array.from(this._languagePacks.keys()).filter(languageId => {
			if (this.getStartupBehavior(languageId) === LanguageStartupBehavior.Disabled) {
				this._logService.debug(`[Runtime startup] Skipping language runtime discovery for language ID '${languageId}' because its startup behavior is disabled.`);
				disabledLanguages.push(languageId);
				return false;
			}
			return true;
		});

		// Activate all extensions that contribute language runtimes.
		await this.activateExtensionsForLanguages(enabledLanguages);

		this._logService.debug(`[Runtime startup] All extensions contributing language runtimes have been activated: [${enabledLanguages.join(', ')}]`);

		// Decide which managers still need a real enumeration, and for those
		// that do, which of their hosted languages to actually run on this
		// pass. On warm starts where every contribution is cache-satisfied
		// (and none is `alwaysRediscover`), this is empty -- we go straight
		// to Complete.
		//
		// Planning runs *before* the foreground cache pass so that any
		// `(extensionId, languageId)` bucket that's about to be re-discovered
		// (signature changed, periodic refresh, cold start, alwaysRediscover)
		// is skipped during cache load. Pre-registering cached runtimes for
		// stale buckets would leak entries that current settings would now
		// filter out -- e.g. an interpreter that the user has just added to
		// `python.interpreters.exclude` -- since `registerRuntime` doesn't
		// re-validate against settings and the subsequent discovery pass
		// doesn't unregister stale entries either.
		const plans: IManagerDiscoveryPlan[] = options.bypassCache
			? this._runtimeManagers.map(m => ({ manager: m, runContributions: [], skipLanguageIds: [] }))
			: await this.managersNeedingFullDiscovery();

		// Collect the buckets that will be re-discovered. Cache load skips
		// these to avoid pre-registering entries that the fresh discovery is
		// about to evaluate against current settings.
		const skipCacheLoad = new Set<string>();
		for (const plan of plans) {
			for (const { extensionId, languageId } of plan.runContributions) {
				skipCacheLoad.add(`${extensionId}::${languageId}`);
			}
		}

		// Foreground cache pass. Skipped when caching is disabled, no entries
		// exist yet, or the caller forced a bypass (rediscover). On bypass we
		// also skip every bucket implicitly via the empty `runContributions`
		// path above -- bypassCache rebuilds plans without populating
		// `runContributions`, so the skip set is empty there. The cache wipe
		// below handles bypass.
		const revalidations: ICacheRevalidationTask[] = options.bypassCache
			? []
			: await this.loadFromDiscoveryCache(skipCacheLoad);

		if (plans.length === 0) {
			// Warm-start fast path. No manager has any work to do; transition
			// straight to Complete. Mark every ext host's discovery flag true
			// so the next rediscover invocation isn't fighting stale state, and
			// signal each ext host that initial discovery is over so any
			// runtime manager registered later (via the public
			// `registerLanguageRuntimeManager` API) self-triggers its own
			// discovery -- the IIFE inside the ext host is gated on a flag
			// that, without this signal, would never flip on a warm start.
			//
			// Pass the cache-satisfied (and disabled) languages as the skip set.
			// The ext host enumerates any manager whose language isn't in this
			// set, so a manager registered via the public API *before* this
			// signal arrived (its language isn't cache-backed) is still
			// discovered rather than stranded, while the cache-backed languages
			// we already served aren't needlessly re-enumerated.
			const skipLanguageIds = Array.from(new Set([
				...this._discoveryCache.getAllBuckets().map(bucket => bucket.languageId),
				...disabledLanguages,
			]));
			for (const manager of this._runtimeManagers) {
				this._discoveryCompleteByExtHostId.set(manager.id, true);
				manager.markDiscoveryComplete(skipLanguageIds);
			}
			this.setStartupPhase(RuntimeStartupPhase.Complete);
		} else {
			// Cold or mixed: enter Discovering for the managers that still
			// need a full pass; mark the rest complete so completeDiscovery()
			// can transition to Complete once the slow ones return.
			this.setStartupPhase(RuntimeStartupPhase.Discovering);
			const planByManager = new Map(plans.map(p => [p.manager.id, p]));
			for (const manager of this._runtimeManagers) {
				if (!planByManager.has(manager.id)) {
					this._discoveryCompleteByExtHostId.set(manager.id, true);
				}
			}
			const reason = options.bypassCache
				? 'user-triggered'
				: this._lastFullDiscoveryReason;
			for (const plan of plans) {
				// Capture-then-discover. Signatures are recorded *before*
				// the manager starts walking the filesystem so a new install
				// that lands during this pass shows up as a delta on the next
				// warm start, rather than being baked into a post-discovery
				// snapshot and missed forever.
				//
				// On the `bypassCache` rediscover path we don't have a plan;
				// fall back to attribution by existing-bucket scan. Otherwise
				// we know the exact `(extensionId, languageId)` pairs being
				// run and can stamp them directly.
				const runPairs = plan.runContributions.length > 0
					? plan.runContributions
					: await this._discoverRunPairsByAttribution(plan.manager);
				await this._captureSignaturesAtDiscoveryStart(plan.manager, runPairs, reason);

				// Wipe cache entries only for the languages this pass will
				// actually re-enumerate. Skipped languages (cache-fresh
				// siblings sharing an ext host with an `alwaysRediscover`
				// contribution) keep their cache: we're not asking the ext
				// host to discover them, so wiping would lose data without
				// a refresh. The pass will repopulate the run languages'
				// cache via `onDidRegisterRuntime`.
				for (const { extensionId, languageId } of runPairs) {
					for (const entry of this._discoveryCache.getEntries(extensionId, languageId)) {
						this._discoveryCache.invalidate(extensionId, languageId, entry.metadata.runtimePath);
					}
				}
				plan.manager.discoverAllRuntimes(disabledLanguages, plan.skipLanguageIds);
			}
		}

		// Kick off background revalidation for entries whose fingerprint
		// changed. Independent of the Discovering/Complete decision above; if
		// nothing changed there's nothing to do.
		if (revalidations.length > 0) {
			this._backgroundDiscoveryInProgress = true;
			this.runBackgroundRevalidations(revalidations).finally(() => {
				this._backgroundDiscoveryInProgress = false;
			});
		}
	}

	/**
	 * Foreground cache pass. For each (extensionId, languageId) bucket, stat
	 * each cached entry's binary and decide:
	 *  - path gone: evict
	 *  - fingerprint matches: register the cached metadata as-is
	 *  - fingerprint changed: register and queue background revalidation so
	 *    the extension can re-hydrate / swap if needed
	 *
	 * @param skipBuckets `(extensionId, languageId)` keys (joined by `::`) for
	 * buckets that are about to be re-discovered on this pass. Their cached
	 * entries are skipped here so the fresh discovery is the sole source of
	 * truth for what gets registered (and what current settings would now
	 * filter out, like a freshly-added exclude path).
	 */
	private async loadFromDiscoveryCache(skipBuckets: ReadonlySet<string> = new Set()): Promise<ICacheRevalidationTask[]> {
		const revalidations: ICacheRevalidationTask[] = [];
		if (!this._discoveryCache.isEnabled()) {
			return revalidations;
		}
		// Skip buckets for languages whose startup behavior is `Disabled`. Without
		// this filter the foreground cache pass would re-register cached runtimes
		// for a disabled language on every warm start, surfacing them in pickers
		// and the registered-runtimes list -- the no-cache path filters disabled
		// languages out of `enabledLanguages` before activating extensions, so
		// no runtimes would have been registered without the cache.
		//
		// Also skip buckets that are about to be re-discovered; pre-registering
		// their cached entries would leak runtimes that current settings now
		// filter out (e.g. a freshly-added `python.interpreters.exclude` path).
		const buckets = this._discoveryCache.getAllBuckets()
			.filter(b => this.getStartupBehavior(b.languageId) !== LanguageStartupBehavior.Disabled)
			.filter(b => !skipBuckets.has(`${b.extensionId}::${b.languageId}`));
		if (buckets.every(b => b.entries.length === 0)) {
			return revalidations;
		}

		this.setStartupPhase(RuntimeStartupPhase.LoadingCache);

		await Promise.all(buckets.map(async bucket => {
			for (const entry of bucket.entries) {
				const probe = await this._discoveryCache.statRuntimePath(entry.metadata.runtimePath);
				if (!probe) {
					this._logService.debug(
						`[Runtime startup] Evicting cached runtime ${formatLanguageRuntimeMetadata(entry.metadata)}: ` +
						`path no longer resolves to a binary.`);
					this._discoveryCache.invalidate(bucket.extensionId, bucket.languageId, entry.metadata.runtimePath);
					continue;
				}
				this._languageRuntimeService.registerRuntime(entry.metadata);
				this._discoveryCache.sessionCounters.foregroundHits++;

				const fp = probe.fingerprint;
				const same = fp.size === entry.fingerprint.size
					&& fp.mtimeMs === entry.fingerprint.mtimeMs
					&& fp.ctimeMs === entry.fingerprint.ctimeMs;
				if (same) {
					this._discoveryCache.markValidated(bucket.extensionId, bucket.languageId, entry.metadata.runtimePath, fp);
				} else {
					revalidations.push({
						extensionId: bucket.extensionId,
						languageId: bucket.languageId,
						metadata: entry.metadata,
						freshFingerprint: fp,
					});
				}
			}
		}));
		return revalidations;
	}

	/**
	 * Plan what each ext-host needs to do on this open. Decisions are made
	 * per `(extensionId, languageId)` and then grouped by ext host so a
	 * single discovery RPC can drive the contributions that actually need it.
	 *
	 * For each contribution the ext host hosts:
	 *  - cache stale (cold-start / roots-changed / periodic) -> include in
	 *    `runLanguageIds`
	 *  - cache fresh and `alwaysRediscover` -> include in `runLanguageIds`
	 *  - cache fresh and not `alwaysRediscover` -> include in `skipLanguageIds`
	 *
	 * A manager whose `runLanguageIds` is empty is omitted from the result.
	 * The caller passes `skipLanguageIds` through to `discoverAllRuntimes`
	 * so the ext host filters its discoverers down to just the languages
	 * that have work this pass. This is what prevents a single
	 * `alwaysRediscover` contribution (e.g. positron-zed) from forcing
	 * sibling languages (positron-r, positron-python) in the same ext host
	 * to re-enumerate when their caches are fresh.
	 */
	private async managersNeedingFullDiscovery(): Promise<IManagerDiscoveryPlan[]> {
		if (!this._discoveryCache.isEnabled()) {
			return this._runtimeManagers.map(m => ({ manager: m, runContributions: [], skipLanguageIds: [] }));
		}

		// Buckets whose last full pass is older than the periodic cap (or that
		// have never had one recorded) trigger a refresh on this open.
		const refreshDays = this._configurationService.getValue<number>(RUNTIME_DISCOVERY_CACHE_REFRESH_INTERVAL_DAYS_SETTING)
			?? RUNTIME_DISCOVERY_CACHE_REFRESH_INTERVAL_DAYS_DEFAULT;
		const periodicCutoff = Date.now() - refreshDays * 24 * 60 * 60 * 1000;

		// Reason precedence: cold-start > always-rediscover > roots-changed >
		// periodic. Track the most-specific reason observed across all managers
		// needing discovery. `always-rediscover` is a permanent contribution
		// opt-out rather than a transient staleness signal, so it ranks below
		// cold-start (which describes a one-time situation) but above the
		// staleness reasons.
		const reasonRank: Record<'cold-start' | 'always-rediscover' | 'roots-changed' | 'periodic', number> = {
			'cold-start': 0,
			'always-rediscover': 1,
			'roots-changed': 2,
			'periodic': 3,
		};
		let observedReason: 'cold-start' | 'always-rediscover' | 'roots-changed' | 'periodic' | undefined;
		const promote = (r: 'cold-start' | 'always-rediscover' | 'roots-changed' | 'periodic') => {
			if (observedReason === undefined || reasonRank[r] < reasonRank[observedReason]) {
				observedReason = r;
			}
		};

		const plans: IManagerDiscoveryPlan[] = [];
		await Promise.all(this._runtimeManagers.map(async manager => {
			// Get the per-(extensionId, languageId) contribution list with
			// each contribution's `alwaysRediscover` flag.
			let contributions: IHostedLanguageContribution[];
			try {
				contributions = await manager.getHostedLanguageContributions();
			} catch (err) {
				this._logService.trace(
					`[Runtime startup] getHostedLanguageContributions threw for manager ${manager.id}: ${err}`);
				// No info: conservatively run a full pass for this ext host.
				plans.push({ manager, runContributions: [], skipLanguageIds: [] });
				promote('cold-start');
				return;
			}

			if (contributions.length === 0) {
				// Ext host hosts no language runtime contributions; nothing to
				// do. (Possible if extensions are activating slowly; the next
				// open will plan properly.)
				return;
			}

			const runContributions: IHostedLanguageContribution[] = [];
			const skipLangs = new Set<string>();
			let mostSpecificReason: 'cold-start' | 'always-rediscover' | 'roots-changed' | 'periodic' | undefined;
			const promoteLocal = (r: 'cold-start' | 'always-rediscover' | 'roots-changed' | 'periodic') => {
				if (mostSpecificReason === undefined || reasonRank[r] < reasonRank[mostSpecificReason]) {
					mostSpecificReason = r;
				}
			};

			for (const contrib of contributions) {
				// User-disabled languages get filtered out of `discoverAllRuntimes`
				// by the existing `disabledLanguageIds` path; don't double-count.
				if (this.getStartupBehavior(contrib.languageId) === LanguageStartupBehavior.Disabled) {
					continue;
				}

				const entries = this._discoveryCache.getEntries(contrib.extensionId, contrib.languageId);
				if (entries.length === 0) {
					// Cold-start for this contribution: no cached entries, so
					// we have to enumerate to find out what it owns. (This
					// also covers `alwaysRediscover` contributions whose
					// runtimes are never cached, like positron-zed.)
					runContributions.push(contrib);
					promoteLocal(contrib.alwaysRediscover ? 'always-rediscover' : 'cold-start');
					continue;
				}

				const lastFullDiscovery = this._discoveryCache.getLastFullDiscovery(contrib.extensionId, contrib.languageId) ?? 0;
				const periodicStale = lastFullDiscovery === 0 || lastFullDiscovery < periodicCutoff;

				// Root-change check: compare the persisted signature against
				// the manager's current one. Per-(extensionId, languageId), so
				// a delta in one contribution doesn't penalize others (and a
				// sibling contribution registered against the same language
				// without `getDiscoveryRootSignature`, e.g. positron-reticulate
				// for `python`, doesn't shadow the real owner's signature).
				const persistedSig = this._discoveryCache.getDiscoveryRootSignature(contrib.extensionId, contrib.languageId);
				const currentSig = await this._safeGetRootSignature(manager, contrib.extensionId, contrib.languageId);
				const rootsChanged = currentSig !== undefined && !signaturesEqual(persistedSig, currentSig);

				if (rootsChanged) {
					runContributions.push(contrib);
					promoteLocal('roots-changed');
				} else if (periodicStale) {
					runContributions.push(contrib);
					promoteLocal('periodic');
				} else if (contrib.alwaysRediscover) {
					runContributions.push(contrib);
					promoteLocal('always-rediscover');
				} else {
					skipLangs.add(contrib.languageId);
				}
			}

			if (runContributions.length > 0) {
				plans.push({
					manager,
					runContributions,
					skipLanguageIds: Array.from(skipLangs),
				});
				if (mostSpecificReason !== undefined) {
					promote(mostSpecificReason);
				}
			}
		}));

		this._lastFullDiscoveryReason = observedReason ?? 'cold-start';
		return plans;
	}

	/**
	 * Capture and persist the manager's current root signature for every
	 * (extensionId, languageId) bucket the manager will produce results for,
	 * and record a per-bucket full-discovery diagnostic stamp. Called once
	 * per manager at the moment we kick off `manager.discoverAllRuntimes()`.
	 *
	 * Why this ordering: the signature is captured *before* the manager
	 * starts walking the filesystem so that an interpreter installed during
	 * the discovery pass shows up as a delta on the next warm start, rather
	 * than being baked into a post-discovery snapshot and missed forever.
	 *
	 * Two attribution paths:
	 *   1. For each existing cache bucket the manager owns (per
	 *      `managesRuntime`), record per (extensionId, languageId) directly.
	 *   2. For every contributed language pack the manager actually responds
	 *      to (`getDiscoveryRootSignature` returns non-undefined), record per
	 *      (extensionId, languageId) for each extension in that language
	 *      pack. This covers the cold-start case where the manager has no
	 *      prior bucket to attribute against.
	 */
	private async _captureSignaturesAtDiscoveryStart(
		manager: IRuntimeManager,
		runPairs: ReadonlyArray<{ extensionId: string; languageId: string }>,
		reason: string,
	): Promise<void> {
		if (runPairs.length === 0) {
			// Diagnostic placeholder: a manager ran with no recorded
			// contributions. Falls back to periodic-refresh after this.
			this._discoveryCache.recordFullDiscoveryRun('*', '*', reason);
			return;
		}

		// Fetch one signature per (extensionId, languageId) pair we'll discover.
		// Managers return undefined for languages they don't handle (or that
		// don't implement the signature API); we just skip the signature
		// update in that case. We key by both extensionId and languageId
		// because multiple extensions can register a manager for the same
		// languageId (e.g. positron-python and positron-reticulate both
		// register for `python`), and only one of them owns the discovery
		// signature for any given bucket.
		const uniquePairs = new Map<string, { extensionId: string; languageId: string }>();
		for (const pair of runPairs) {
			uniquePairs.set(`${pair.extensionId}::${pair.languageId}`, pair);
		}
		const sigByPair = new Map<string, IRuntimeRootSignature>();
		await Promise.all(Array.from(uniquePairs.values()).map(async ({ extensionId, languageId }) => {
			const sig = await this._safeGetRootSignature(manager, extensionId, languageId);
			if (sig !== undefined) {
				sigByPair.set(`${extensionId}::${languageId}`, sig);
			}
		}));

		const stampedAt = Date.now();
		const recordedKeys = new Set<string>();
		for (const { extensionId, languageId } of runPairs) {
			const key = `${extensionId}::${languageId}`;
			if (recordedKeys.has(key)) { continue; }
			recordedKeys.add(key);
			this._discoveryCache.recordFullDiscoveryRun(extensionId, languageId, reason);
			// Stamp `lastFullDiscovery` now, at the start of the pass: the
			// periodic-refresh check reads this value on the next open and
			// what matters is that *a* pass ran, not exactly when each
			// runtime registered. Stamping per-runtime via
			// `onDidRegisterRuntime` would miss buckets that legitimately
			// produce zero runtimes on this open.
			this._discoveryCache.setLastFullDiscovery(extensionId, languageId, stampedAt);
			const sig = sigByPair.get(key);
			if (sig !== undefined) {
				this._discoveryCache.setDiscoveryRootSignature(extensionId, languageId, sig);
			}
		}
	}

	/**
	 * Fallback attribution path used only by the rediscover/bypass-cache
	 * code path, which doesn't run through `managersNeedingFullDiscovery`.
	 * Walks existing cache buckets and asks the manager if it owns each.
	 */
	private async _discoverRunPairsByAttribution(
		manager: IRuntimeManager,
	): Promise<{ extensionId: string; languageId: string }[]> {
		const pairs: { extensionId: string; languageId: string }[] = [];
		for (const bucket of this._discoveryCache.getAllBuckets()) {
			if (bucket.entries.length === 0) { continue; }
			try {
				if (await manager.managesRuntime(bucket.entries[0].metadata)) {
					pairs.push({ extensionId: bucket.extensionId, languageId: bucket.languageId });
				}
			} catch (err) {
				this._logService.trace(
					`[Runtime startup] managesRuntime threw while attributing bypass pairs: ${err}`);
			}
		}
		return pairs;
	}

	/**
	 * Call `manager.getDiscoveryRootSignature(extensionId, languageId)`
	 * defensively: timeout-bound the call, swallow throws, and treat both as
	 * "no signature available" so the caller falls back to the periodic-
	 * refresh trigger. We disambiguate by extensionId because multiple
	 * extensions can register a runtime manager for the same languageId (e.g.
	 * `ms-python.python` and `positron.positron-reticulate` both register for
	 * `python`) and only one of them owns the discovery signature for any
	 * given (extensionId, languageId) bucket.
	 */
	private async _safeGetRootSignature(
		manager: IRuntimeManager,
		extensionId: string,
		languageId: string,
	): Promise<IRuntimeRootSignature | undefined> {
		try {
			return await raceTimeout(
				manager.getDiscoveryRootSignature(extensionId, languageId),
				RuntimeStartupService.ROOT_SIGNATURE_TIMEOUT_MS,
				() => this._logService.warn(
					`[Runtime startup] getDiscoveryRootSignature(${extensionId}, ${languageId}) timed out ` +
					`for manager ${manager.id}; falling back to periodic refresh.`),
			);
		} catch (err) {
			this._logService.warn(
				`[Runtime startup] getDiscoveryRootSignature(${extensionId}, ${languageId}) threw ` +
				`for manager ${manager.id}; falling back to periodic refresh: ${err}`);
			return undefined;
		}
	}

	/**
	 * Reason classification set as a side-effect of the most recent
	 * `managersNeedingFullDiscovery()` call. The per-manager iteration already
	 * walks the buckets we'd need to inspect for this, so caching the result
	 * here is cheaper than a sibling helper that re-walks them. `bypassCache`
	 * paths overwrite this with `'user-triggered'` at the call site.
	 *
	 * Precedence (most-specific wins): `cold-start` > `always-rediscover` >
	 * `roots-changed` > `periodic`. `cold-start` covers managers that never
	 * produced any cached runtimes; `always-rediscover` covers managers that
	 * opted out of the cache fast path entirely (non-cacheable runtimes);
	 * `roots-changed` covers warm starts where a scan-root mtime moved (a new
	 * interpreter likely showed up); `periodic` covers warm starts where the
	 * bucket simply aged past the refresh cap.
	 */
	private _lastFullDiscoveryReason: 'cold-start' | 'always-rediscover' | 'roots-changed' | 'periodic' = 'cold-start';

	/**
	 * Per-manager budget for `getDiscoveryRootSignature`. The call should be
	 * a handful of stats and complete in single-digit milliseconds; if it
	 * doesn't, log and treat as "no signature" (fall back to periodic) rather
	 * than blocking warm-start latency on a slow extension.
	 */
	private static readonly ROOT_SIGNATURE_TIMEOUT_MS = 500;

	/**
	 * Run cached-entry revalidations in batches of at most 4 concurrent
	 * `validateMetadata` calls. On thrown error, evict; otherwise refresh the
	 * cached metadata + fingerprint and re-register if the runtime ID changed.
	 */
	private async runBackgroundRevalidations(tasks: ICacheRevalidationTask[]): Promise<void> {
		const limiter = new Limiter<void>(4);
		await Promise.all(tasks.map(task => limiter.queue(() => this.revalidateOne(task))));
	}

	private async revalidateOne(task: ICacheRevalidationTask): Promise<void> {
		this._discoveryCache.sessionCounters.revalidationsAttempted++;
		// Find the manager that owns this runtime.
		let owner: IRuntimeManager | undefined;
		for (const manager of this._runtimeManagers) {
			try {
				if (await manager.managesRuntime(task.metadata)) {
					owner = manager;
					break;
				}
			} catch (err) {
				this._logService.trace(`[Runtime startup] managesRuntime threw during revalidation: ${err}`);
			}
		}
		if (!owner) {
			this._discoveryCache.sessionCounters.revalidationsFailed++;
			this._discoveryCache.invalidate(task.extensionId, task.languageId, task.metadata.runtimePath);
			return;
		}
		try {
			const validated = await owner.validateMetadata(task.metadata);
			this._discoveryCache.sessionCounters.revalidationsSucceeded++;
			// Registry swap: if the validator returned different metadata,
			// register it (the registry tolerates re-registration on the same
			// path with a new runtimeId, mirroring the affiliated-cache path).
			if (validated.runtimeId !== task.metadata.runtimeId) {
				this._logService.info(
					`[Runtime startup] Cached runtime drifted; ` +
					`replacing ${formatLanguageRuntimeMetadata(task.metadata)} ` +
					`with ${formatLanguageRuntimeMetadata(validated)}`);
				this._languageRuntimeService.registerRuntime(validated);
			}
			// If the validator redirected the runtime to a different binary --
			// e.g. R's validateMetadata re-resolves a `current: true` entry to
			// wherever the rig `current`/`Current` symlink points right now --
			// the cache is keyed by `runtimePath`, so an `upsert` of the new
			// path would leave the original entry behind. Evict the old key so
			// the cache can't accumulate stale or duplicate "current" entries
			// across sessions.
			if (validated.runtimePath !== task.metadata.runtimePath) {
				this._discoveryCache.invalidate(task.extensionId, task.languageId, task.metadata.runtimePath);
			}
			// Refresh the cache entry with the (possibly-updated) metadata
			// and the fresh fingerprint we already captured.
			await this._discoveryCache.upsert(validated);
		} catch (err) {
			this._discoveryCache.sessionCounters.revalidationsFailed++;
			this._logService.info(
				`[Runtime startup] Cache revalidation failed for ` +
				`${formatLanguageRuntimeMetadata(task.metadata)}; evicting: ${err}`);
			this._discoveryCache.invalidate(task.extensionId, task.languageId, task.metadata.runtimePath);
		}
	}

	/**
	 * Runs as an event handler when a new runtime is registered; checks to see
	 * if the runtime is affiliated with this workspace, and if so, starts the
	 * runtime.
	 *
	 * @param runtime The newly registered runtime.
	 */
	private onDidRegisterRuntime(metadata: ILanguageRuntimeMetadata): void {

		// During a real discovery pass (cold-start full discovery, user-triggered
		// rediscover, or a background refresh), feed cacheable runtimes into the
		// cross-window cache. Cache hits replayed during `LoadingCache` are
		// already in the cache and don't need to be re-upserted.
		//
		// `lastFullDiscovery` is stamped at the start of the pass in
		// `_captureSignaturesAtDiscoveryStart` (so buckets that legitimately
		// produce zero runtimes on this open still get refreshed), not here.
		if (metadata.cacheable === true &&
			(this._startupPhase === RuntimeStartupPhase.Discovering || this._backgroundDiscoveryInProgress)) {
			this._discoveryCache.upsert(metadata).catch(err => {
				this._logService.warn(
					`[Runtime startup] Failed to cache runtime ${formatLanguageRuntimeMetadata(metadata)}: ${err}`);
			});
		}

		// The remaining work is the affiliated-runtime auto-start. We act in
		// both Discovering (cold start) and LoadingCache (warm-start cache hit),
		// since a cache-loaded runtime can match the workspace affiliation just
		// like a freshly-discovered one would.
		if (this._startupPhase !== RuntimeStartupPhase.Discovering &&
			this._startupPhase !== RuntimeStartupPhase.LoadingCache) {
			return;
		}

		// Ignore if we already have a console starting for this language.
		if (this._runtimeSessionService.hasStartingOrRunningConsole(metadata.languageId)) {
			return;
		}

		// Ignore if there's already a foreground session, regardless of
		// language; at this point either we've autostarted a different runtime
		// or the user has manually started a runtime, and we don't want to
		// interfere by starting another one.
		if (this._runtimeSessionService.foregroundSession) {
			return;
		}

		// Get the runtime metadata that is affiliated with this workspace, if any.
		const affiliatedRuntimeMetadataStr = this._storageService.get(
			this.storageKeyForRuntime(metadata), this.affiliationStorageScope());
		if (!affiliatedRuntimeMetadataStr) {
			return;
		}
		const affiliated = JSON.parse(affiliatedRuntimeMetadataStr) as IAffiliatedRuntimeMetadata;
		const affiliatedRuntimeId = affiliated.metadata.runtimeId;

		// If the runtime is affiliated with this workspace, start it.
		if (metadata.runtimeId === affiliatedRuntimeId) {
			try {

				// Check the setting to see if we should be auto-starting.
				const startupBehavior = this.getStartupBehavior(metadata.languageId);
				if (startupBehavior === LanguageStartupBehavior.Disabled ||
					startupBehavior === LanguageStartupBehavior.Manual) {
					this._logService.info(`Language runtime ` +
						`${formatLanguageRuntimeMetadata(affiliated.metadata)} ` +
						`is affiliated with this workspace, but won't be started because ` +
						`the ${metadata.languageName} startup behavior is ${startupBehavior}.`);
					return;
				}

				if (metadata.startupBehavior === LanguageRuntimeStartupBehavior.Manual) {
					this._logService.info(`Language runtime ` +
						`${formatLanguageRuntimeMetadata(affiliated.metadata)} ` +
						`is affiliated with this workspace, but won't be started because its ` +
						`startup behavior is manual.`);
					return;
				}

				this._runtimeSessionService.startNewRuntimeSession(
					metadata.runtimeId,
					metadata.runtimeName,
					LanguageRuntimeSessionMode.Console,
					undefined, // Console session
					`Affiliated runtime for workspace registered`,
					RuntimeStartMode.Starting,
					true);
			} catch (e) {
				// This isn't necessarily an error; if another runtime took precedence and has
				// already started for this workspace, we don't want to start this one.
				this._logService.debug(`Did not start affiliated runtime ` +
					`${metadata.runtimeName} for this workspace: ` +
					`${e.message}`);
			}
		}
	}

	/**
	 * Get the runtime ID affiliated with the given language ID.
	 *
	 * @param languageId The ID of the language for which to get the affiliated runtime.
	 *
	 * @returns The runtime metadata.
	 */
	public getAffiliatedRuntimeMetadata(languageId: string): ILanguageRuntimeMetadata | undefined {
		const affiliated = this.getAffiliatedRuntime(languageId);
		if (!affiliated) {
			return undefined;
		}
		return affiliated.metadata;
	}

	/**
	 * Get all the recommended runtimes for this workspace.
	 *
	 * @param disabledLanguageIds The language IDs that are disabled.
	 * @returns An array of recommended runtimes.
	 */
	private async getRecommendedRuntimes(disabledLanguageIds: string[]): Promise<ILanguageRuntimeMetadata[]> {

		// Ask each extension to recommend runtimes for this workspace.
		const metadata = await Promise.all(
			this._runtimeManagers.map(
				manager => manager.recommendWorkspaceRuntimes(disabledLanguageIds))
		);

		// Each extension host returns an array; flatten the array of arrays.
		return metadata.flat();
	}

	private getAffiliatedRuntime(languageId: string): IAffiliatedRuntimeMetadata | undefined {
		const stored = this._storageService.get(`${this.storageKey}.${languageId}`,
			this.affiliationStorageScope());
		if (!stored) {
			return undefined;
		}
		try {
			const affiliated = JSON.parse(stored) as IAffiliatedRuntimeMetadata;
			return affiliated;
		} catch (err) {
			this._logService.error(`Error parsing JSON for ${this.storageKey}: ${err}`);
			return undefined;
		}
	}

	/**
	 * Ascertains what languages are affiliated with the current workspace.
	 *
	 * @returns An array of language IDs for which there is a runtime affiliated
	 */
	public getAffiliatedRuntimeLanguageIds(): string[] {
		// Get the keys from the storage service and find the language Ids.
		const languageIds = new Array<string>();
		const keys = this._storageService.keys(this.affiliationStorageScope(),
			StorageTarget.MACHINE);
		for (const key of keys) {
			if (key.startsWith(this.storageKey)) {
				languageIds.push(key.replace(`${this.storageKey}.`, ''));
			}
		}
		return languageIds;
	}

	/**
	 * Ascertains whether a runtime (of any language) is affiliated with the
	 * current workspace.
	 *
	 * @returns True if there is a runtime affiliated with this workspace.
	 */
	public hasAffiliatedRuntime(): boolean {
		// Get the keys from the storage service and see if any of them match
		// the storage key pattern for affiliated runtimes.
		const keys = this._storageService.keys(
			this.affiliationStorageScope(), StorageTarget.MACHINE);
		for (const key of keys) {
			if (key.startsWith(this.storageKey)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Gets the preferred runtime for a language
	 *
	 * @param languageId The language identifier
	 * @returns The preferred runtime metadata, or undefined if no preferred
	 *  runtime is available.
	 */
	public getPreferredRuntime(languageId: string): ILanguageRuntimeMetadata | undefined {
		// If there's an active session for the language, return it.
		const activeSession =
			this._runtimeSessionService.getConsoleSessionForLanguage(languageId);
		if (activeSession) {
			return activeSession.runtimeMetadata;
		}

		// If there's a runtime affiliated with the workspace for the language,
		// return it.
		const affiliatedRuntimeMetadata = this.getAffiliatedRuntimeMetadata(languageId);
		if (affiliatedRuntimeMetadata) {
			const affiliatedRuntimeInfo =
				this._languageRuntimeService.getRegisteredRuntime(affiliatedRuntimeMetadata.runtimeId);
			if (affiliatedRuntimeInfo) {
				return affiliatedRuntimeInfo;
			}
		}

		// If there is a most recently started runtime for the language, return it.
		const mostRecentlyStartedRuntime = this._mostRecentlyStartedRuntimesByLanguageId.get(languageId);
		if (mostRecentlyStartedRuntime) {
			return mostRecentlyStartedRuntime;
		}

		// If there are registered runtimes for the language, return the first.
		const languageRuntimeInfos =
			this._languageRuntimeService.registeredRuntimes
				.filter(info => info.languageId === languageId);
		if (languageRuntimeInfos.length) {
			return languageRuntimeInfos[0];
		}

		// Nothing is registered, so we don't have a preferred runtime for this language.
		return undefined;
	}

	/**
	 * Starts all recommended runtimes for the workspace.
	 */
	private async startRecommendedLanguageRuntimes(disabledLanguageIds: string[], enabledLanguageIds: string[]): Promise<void> {
		// Activate all the extensions that might recommend language runtimes
		// for the enabled languages.
		await this.activateExtensionsForLanguages(enabledLanguageIds);

		// Have the extensions recommend runtimes for this workspace.
		const runtimes = await this.getRecommendedRuntimes(disabledLanguageIds);
		if (runtimes.length === 0) {
			return;
		}

		// Start the recommended runtimes.
		const promises = runtimes.map(async (runtime, idx) => {
			// Ensure that the runtime isn't disabled; we try to avoid getting these
			// in the first place by not querying for them, but technically any
			// runtime manager could return a disabled runtime.
			if (disabledLanguageIds.includes(runtime.languageId)) {
				this._logService.debug(`[Runtime startup] Skipping language runtime startup for language ID '${runtime.languageId}' because its startup behavior is disabled.`);
				return;
			}

			// Register the runtime with the language runtime service.
			// Pre-registering prevents the runtime from being unnecessarily
			// validated later.
			this._register(this._languageRuntimeService.registerRuntime(runtime));

			if (runtime.startupBehavior === LanguageRuntimeStartupBehavior.Immediate) {
				// Start the runtime immediately if it has Immediate startup
				// behavior.
				await this.autoStartRuntime(runtime,
					`The ${runtime.extensionId.value} extension recommended the runtime to be started in this workspace.`,
					idx === 0);
			} else {
				// For other startup behaviors, we just save the runtime as the
				// default (unless the workspace already has an affiliated
				// runtime for this language).
				const oldAffiliation = this.getAffiliatedRuntime(runtime.languageId);
				if (!oldAffiliation) {
					const affiliated: IAffiliatedRuntimeMetadata = {
						metadata: runtime,
						// Marking lastUsed = lastStarted = 0 will prevent
						// auto-startup.
						lastUsed: 0,
						lastStarted: 0
					};
					this.saveAffiliatedRuntime(affiliated);
				}
			}
		});

		await Promise.all(promises);
	}

	/**
	 * Starts all affiliated runtimes for the workspace.
	 */
	private async startAffiliatedLanguageRuntimes(disabledLanguageIds: string[], _enabledLanguageIds: string[]): Promise<void> {
		let languageIds = this.getAffiliatedRuntimeLanguageIds();

		// Remove any fully disabled languages
		languageIds = languageIds.filter(languageId => {
			return !disabledLanguageIds.includes(languageId);
		});

		// Ensure the startup behavior is set to 'Always' or 'Auto' for each language.
		languageIds = languageIds.filter(languageId => {
			const startupBehavior = this.getStartupBehavior(languageId);
			return startupBehavior === LanguageStartupBehavior.Always || startupBehavior === LanguageStartupBehavior.Auto;
		});

		// No affiliated runtimes; move on to the next phase.
		if (languageIds.length === 0) {
			return;
		}

		// Build the sorted, filtered list of affiliations to start.
		const affiliations = languageIds.map(languageId => {
			// Get the affiliated runtime metadata.
			return this.getAffiliatedRuntime(languageId);
		}).filter(affiliation => {
			// Filter out any affiliations that didn't deserialize properly.
			return affiliation !== undefined;
		}).filter(affiliation => {
			// Filter out runtimes that aren't actually being used by removing those with a
			// lastUsed time that is less than the lastStarted time.

			// Only do this if there is more than one runtime affiliated with
			// the workspace. We generally want at least one runtime to start.
			if (languageIds.length === 1) {
				return true;
			}

			// Runtimes that have never been started or used are not
			// auto-started; they are just used to set defaults.
			if (affiliation.lastStarted === 0 &&
				affiliation.lastUsed === 0) {
				this._logService.debug(`[Runtime startup] Affiliated runtime ` +
					`${formatLanguageRuntimeMetadata(affiliation.metadata)} ` +
					`not marked for autostart`);

				return false;
			}

			// Compare the last used time to the last started time; log if
			// we're going to forget a runtime.
			if (affiliation.lastStarted > affiliation.lastUsed) {
				this._logService.debug(`[Runtime startup] Affiliated runtime ` +
					`${formatLanguageRuntimeMetadata(affiliation.metadata)} ` +
					`last used on ${new Date(affiliation.lastUsed).toLocaleString()}, ` +
					`last started on ${new Date(affiliation.lastStarted).toLocaleString()}. ` +
					`It will not be auto-started`);
				return false;
			}
			return true;
		}).sort((a, b) => {
			// Sort the affiliations by last used time, so that the most recently
			// used runtime is started first
			return b.lastUsed - a.lastUsed;
		});

		if (affiliations.length === 0) {
			return;
		}

		// Start the primary (first) affiliated runtime synchronously: activate
		// only its extension, then start it, before returning. This ensures
		// that the caller sees a starting/running console and avoids falling
		// through to slower paths that activate all extensions.
		const primary = affiliations[0];
		this._onWillAutoStartRuntime.fire({
			runtime: primary.metadata,
			newSession: true,
			activate: true
		});
		await this.activateExtensionsForLanguages([primary.metadata.languageId]);
		await this.startAffiliatedRuntime(primary, true);

		// Start the remaining affiliated runtimes in the background; they
		// do not need to block the startup sequence.
		for (let i = 1; i < affiliations.length; i++) {
			const affiliation = affiliations[i];
			this.activateExtensionsForLanguages([affiliation.metadata.languageId]).then(() => {
				this.startAffiliatedRuntime(affiliation, false);
			});
		}
	}

	/**
	 * Convenience method for creating a storage key for a given runtime.
	 *
	 * @param runtime The runtime for which to get the storage key.
	 *
	 * @returns A string used to store the affiliated runtime ID for the given runtime.
	 */
	private storageKeyForRuntime(metadata: ILanguageRuntimeMetadata): string {
		return `${this.storageKey}.${metadata.languageId}`;
	}

	/**
	 * Returns the storage scope to use for storing runtime affiliations. We use
	 * the workspace storage scope if we have a workspace, and the profile scope
	 * otherwise.
	 *
	 * @returns The storage scope to use for storing the affiliation.
	 */
	private affiliationStorageScope(): StorageScope {
		if (this._workspaceContextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			return StorageScope.PROFILE;
		}
		return StorageScope.WORKSPACE;
	}

	/**
	 * Activates a single extension. Always calls through to activateById() so
	 * that in-progress activations are properly awaited. The
	 * _activatedExtensions set is used only to deduplicate logging and
	 * performance marks.
	 *
	 * @param extensionId The extension to activate.
	 * @param languageId The language ID triggering the activation.
	 */
	private async activateExtension(extensionId: ExtensionIdentifier, languageId: string): Promise<void> {
		const key = extensionId.value;
		// Add to the set immediately (before the await) to prevent
		// concurrent calls from emitting duplicate perf marks.
		const firstActivation = !this._activatedExtensions.has(key);
		if (firstActivation) {
			this._activatedExtensions.add(key);
			perf.mark(`code/positron/runtimeStartup/extensionPreActivate/${key}`);
			this._logService.debug(`[Runtime startup] Activating extension ${key} for language ID ${languageId}`);
		}
		try {
			await this._extensionService.activateById(extensionId,
				{
					extensionId: extensionId,
					activationEvent: `onLanguageRuntime:${languageId}`,
					startup: false
				});
			if (firstActivation) {
				perf.mark(`code/positron/runtimeStartup/extensionPostActivate/${key}`);
			}
		} catch (e) {
			if (firstActivation) {
				this._activatedExtensions.delete(key);
			}
			this._logService.debug(
				`[Runtime startup] Error activating extension ${key}: ${e}`);
		}
	}

	/**
	 * Activates the extensions that provide language runtimes for the given
	 * language IDs.
	 *
	 * @param languageIds The language IDs for which to activate the extensions.
	 */
	private async activateExtensionsForLanguages(languageIds: Array<string>): Promise<void> {
		const activationPromises = languageIds.map(
			async (languageId) => {
				for (const extension of this._languagePacks.get(languageId) || []) {
					await this.activateExtension(extension, languageId);
				}
			});
		await Promise.all(activationPromises);
	}

	/**
	 * Starts an affiliated runtime for a single language.
	 *
	 * @param affiliatedRuntimeMetadata The metadata for the affiliated runtime.
	 * @param activate Whether to activate/focus the new session
	 */
	private async startAffiliatedRuntime(
		affiliatedRuntime: IAffiliatedRuntimeMetadata,
		activate: boolean
	): Promise<void> {

		// No-op if no affiliated runtime metadata.
		if (!affiliatedRuntime.metadata) {
			return;
		}

		const affiliatedRuntimeMetadata = affiliatedRuntime.metadata;

		if (affiliatedRuntimeMetadata.startupBehavior === LanguageRuntimeStartupBehavior.Manual) {
			this._logService.info(`Language runtime ` +
				`${formatLanguageRuntimeMetadata(affiliatedRuntimeMetadata)} ` +
				`is affiliated with this workspace, but won't be started because its startup ` +
				`behavior is manual.`);
			return;
		}

		// Save the start time of the affiliated runtime.
		affiliatedRuntime.lastStarted = Date.now();
		this.saveAffiliatedRuntime(affiliatedRuntime);

		await this.autoStartRuntime(affiliatedRuntimeMetadata,
			`Affiliated ${affiliatedRuntimeMetadata.languageName} runtime for workspace`,
			activate);
	}

	/**
	 * Restores the set of active workspace sessions from ephemeral storage.
	 */
	private async restoreSessions() {

		this._logService.debug(`[Runtime startup] Session restore; workspace: ${this._workspaceContextService.getWorkspace().id}, workbench state: ${this._workspaceContextService.getWorkbenchState()}, startupKind: ${this._lifecycleService.startupKind}`);

		// Wait until we've discovered all the sessions that might need to be restored
		const sessions = await this.getRestoredSessions();

		// No sessions to restore?
		if (sessions.length === 0) {
			return;
		}

		// If this workspace has sessions, attempt to reconnect to
		// them.
		try {
			await this.restoreWorkspaceSessions(sessions);
		} catch (err) {
			this._logService.error(`Could not restore workspace sessions: ${err?.stack ?? err} ` +
				`(data: ${JSON.stringify(sessions)})`);
		}
	}

	/**
	 * Restores the set of active workspace sessions from the workspace storage,
	 * reconnecting to each one.
	 *
	 * @param sessions The set of sessions to restore.
	 */
	private async restoreWorkspaceSessions(sessions: SerializedSessionMetadata[]) {

		this.setStartupPhase(RuntimeStartupPhase.Reconnecting);

		// Sort the sessions by last used time, so that we reconnect to the
		// most recently used sessions first. Default 0 so we can restore
		// sessions that didn't persist this information.
		sessions.sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));

		// Let the UI know we're about to try reconnecting to this session
		this._onWillAutoStartRuntime.fire({
			runtime: sessions[0].runtimeMetadata,
			newSession: false,
			activate: true
		});

		// Activate any extensions needed for the sessions we want to reconnect
		// to. We need the extension to be active so that we can ask it to
		// validate the session before connecting to it.
		// Note: we activate extensions for *all* sessions here, not just
		// machine-persistent ones, because activateById() returns before the
		// extension has fully registered its session managers. Pre-activating
		// all extensions ensures managers are ready by the time we attempt to
		// reconnect below.
		await Promise.all(sessions.map(async session => {
			await this.activateExtension(
				session.runtimeMetadata.extensionId,
				session.runtimeMetadata.languageId);
		}));

		// Before reconnecting, validate any sessions that need it.
		const validSessions = await Promise.all(sessions.map(async session => {
			if (session.runtimeMetadata.sessionLocation === LanguageRuntimeSessionLocation.Browser) {
				// Browser sessions are never valid since they cannot be
				// reconnected. It'd be surprising to find one persisted.
				this._logService.info(`[Runtime startup] Not restoring unexpected persisted ` +
					`browser session ${session.sessionName} (${session.metadata.sessionId})`);
				return false;
			} else {
				// If the session is persistent on the machine, we need to
				// check to see if it is still valid (i.e. still running)
				// before reconnecting.
				this._logService.debug(`[Runtime startup] Checking to see if persisted session ` +
					`${session.sessionName} (${session.metadata.sessionId}) is still valid.`);
				try {
					// Ask the runtime session service to validate the session.
					// This call will eventually be proxied through to the
					// extension that provides the runtime.
					const valid = await this._runtimeSessionService.validateRuntimeSession(
						session.runtimeMetadata,
						session.metadata.sessionId);
					perf.mark(`code/positron/runtimeSessionValidated/${session.metadata.sessionId}`);

					this._logService.debug(
						`[Runtime startup] Session ` +
						`${session.sessionName} (${session.metadata.sessionId}) valid = ${valid}`);

					// Fire an event to clean up provisional copies of the session
					if (!valid) {
						const error: ISessionRestoreFailedEvent = {
							sessionId: session.metadata.sessionId,
							error: new Error(`Session is no longer available`)
						};
						this._onSessionRestoreFailure.fire(error);
					}

					return valid;
				} catch (err) {
					// This is a non-fatal error since we can just avoid reconnecting
					// to the session.
					this._logService.error(
						`Error validating persisted session ` +
						`${session.sessionName} (${session.metadata.sessionId}): ${err}`);

					// Fire an event to clean up provisional copies of the session
					const error: ISessionRestoreFailedEvent = {
						sessionId: session.metadata.sessionId,
						error: new Error(`Could not validate session: ${err}`)
					};
					this._onSessionRestoreFailure.fire(error);
					return false;
				}
			}
		}));

		// Remove all the sessions that are no longer valid.
		sessions = sessions.filter((_, i) => validSessions[i]);

		// Reconnect to the remaining sessions.
		this._logService.debug(`Reconnecting to sessions: ` +
			sessions.map(session => session.sessionName).join(', '));

		// Keep track of whether we are expecting to see the first console
		// session
		let firstConsole = true;

		await Promise.all(sessions.map(async (session, idx) => {
			const marker =
				`[Reconnect ${session.metadata.sessionId} (${idx + 1}/${sessions.length})]`;

			// Activate the extension that provides the runtime if it hasn't
			// been activated already (e.g. workspace-local sessions that
			// weren't covered by the machine-session activation above).
			await this.activateExtension(
				session.runtimeMetadata.extensionId,
				session.runtimeMetadata.languageId);

			this._logService.debug(`${marker}: Restoring session for ` +
				`${session.sessionName}`);

			// Activate (i.e. make foreground) the first console session
			// we reconnect to. Notebook sessions are never activated as
			// part of reconnection; the foreground session for a notebook
			// is set by the editor focus path when the user activates
			// the corresponding editor (so reconnected sessions for
			// background tabs do not steal foreground from the active
			// editor).
			const isConsoleSession = !session.metadata.notebookUri;
			const activate = firstConsole && isConsoleSession;
			if (isConsoleSession) {
				firstConsole = false;
			}

			try {
				// Reconnect to the session; activate it if it is the first console
				// session
				await this._runtimeSessionService.restoreRuntimeSession(
					session.runtimeMetadata, session.metadata, session.sessionName, session.hasConsole, activate);
			} catch (err) {
				// If an error occurs, fire an event to clean up provisional copies
				const error: ISessionRestoreFailedEvent = {
					sessionId: session.metadata.sessionId,
					error: new Error(`Could not reconnect: ${JSON.stringify(err)}`)
				};
				this._onSessionRestoreFailure.fire(error);
			}
		}));
	}

	/**
	 * Clear the set of workspace sessions in the ephemeral workspace storage.
	 */
	private async clearWorkspaceSessions(): Promise<boolean> {
		// Clear the sessions. Note that we only ever clear the sessions from
		// the ephemeral storage, since the persisted sessions are meant to be
		// restored later.
		await this._ephemeralStateService.removeItem(this.getEphemeralWorkspaceSessionsKey());

		// Always return false (don't veto shutdown)
		return false;
	}

	/**
	 * Update the set of workspace sessions in the workspace storage.
	 *
	 * @param removeSessionId Optionally, a session ID to remove from the
	 * workspace sessions.
	 *
	 * @returns False, always, so that it can be called during the shutdown
	 * process.
	 */
	private async saveWorkspaceSessions(removeSessionId?: string): Promise<boolean> {
		// Derive the set of sessions that are currently active
		const activeSessions = this._runtimeSessionService.activeSessions
			.filter(session =>
				session.getRuntimeState() !== RuntimeState.Uninitialized &&
				session.getRuntimeState() !== RuntimeState.Initializing &&
				session.getRuntimeState() !== RuntimeState.Exited
			)
			.map(session => {
				const activeSession =
					this._runtimeSessionService.getActiveSession(session.metadata.sessionId);

				const metadata: SerializedSessionMetadata = {
					sessionName: session.dynState.sessionName,
					metadata: session.metadata,
					sessionState: session.getRuntimeState(),
					runtimeMetadata: session.runtimeMetadata,
					workingDirectory: activeSession?.workingDirectory || '',
					hasConsole: activeSession?.hasConsole || false,
					lastUsed: session.lastUsed,
					localWindowId: this._localWindowId,
				};

				return metadata;
			});

		// Diagnostic logs: what are we saving?
		this._logService.trace(`Saving workspace sessions: ${activeSessions.map(session =>
			`${session.sessionName} (${session.metadata.sessionId}, ${session.runtimeMetadata.sessionLocation})`).join(', ')}`);

		// Save the ephemeral sessions to the workspace storage.
		const workspaceSessions = activeSessions.filter(session =>
			session.runtimeMetadata.sessionLocation === LanguageRuntimeSessionLocation.Workspace);

		// Get the existing sessions from ephemeral storage
		const existingSessions = Array.from(
			await this._ephemeralStateService.getItem<SerializedSessionMetadata[]>(
				this.getEphemeralWorkspaceSessionsKey()) || []);
		const activeSessionIds: Set<string> =
			new Set(workspaceSessions.map(session => session.metadata.sessionId));

		// We need to update the storage with the new set of sessions, but we
		// also need to avoid removing any sessions could still be active in
		// other windows. Filter the existing sessions to build a set of sesions
		// to preserve in storage.
		const preservedSessions = existingSessions.filter(session => {
			if (activeSessionIds.has(session.metadata.sessionId)) {
				// We have a copy of this session in the active sessions; we will replace
				// it with the new session
				return false;
			}
			if (session.metadata.sessionId === removeSessionId) {
				// This session exited, so it should be removed
				return false;
			}
			if (session.localWindowId !== this._localWindowId) {
				// Keep the session if it is from a different window _and_ isn't
				// going to be replaced with an incoming session
				return true;
			}
			// Remove everything else
			return false;
		});

		// Add the workspace sessions to the preserved sessions to form the new
		// set of sessions to be written to storage
		const newSessions = preservedSessions.concat(workspaceSessions);

		// Save the new sessions to ephemeral storage
		this._logService.debug(`[Runtime startup] Saving ephemeral workspace sessions ` +
			`(${workspaceSessions.length} local, ${newSessions.length} total)`);
		this._ephemeralStateService.setItem(this.getEphemeralWorkspaceSessionsKey(),
			newSessions);

		// Save the persisted sessions to the workspace storage.
		const machineSessions = activeSessions.filter(session =>
			session.runtimeMetadata.sessionLocation === LanguageRuntimeSessionLocation.Machine);
		this._logService.debug(`[Runtime startup] Saving machine-persisted workspace sessions (${machineSessions.length})`);
		this._storageService.store(
			PERSISTENT_WORKSPACE_SESSIONS,
			JSON.stringify(machineSessions),
			this.getPersistentSessionStorageScope(), StorageTarget.MACHINE);

		return false;
	}

	/**
	 * Gets the storage scope for persistent sessions.
	 *
	 * Currently, we always use the workspace scope for persistent sessions.
	 * This isn't ideal because it means that the empty workspace doesn't get
	 * persistent sessions in remote scenarios, but it avoids complications with
	 * multiple empty workspaces having different sets of persistent sessions.
	 *
	 * @returns The storage scope for persistent sessions.
	 */
	private getPersistentSessionStorageScope(): StorageScope {
		return StorageScope.WORKSPACE;
	}

	/**
	 * Automatically restarts the session after a crash, if necessary.
	 *
	 * @param session The session that exited.
	 * @param exit The reason the session exited.
	 * @returns True if the session should be cleaned up, or false if not.
	 */
	private async restartAfterCrash(session: ILanguageRuntimeSession, exit: ILanguageRuntimeExit): Promise<boolean> {
		// Ignore if we are still starting up; if a runtime crashes or exits
		// during startup, we'll usually try to start a better one instead of
		// booting to a broken REPL.
		if (this._startupPhase !== RuntimeStartupPhase.Complete) {
			// We don't want to clean up the session if we're still starting up.
			return false;
		}

		const restartOnCrash =
			this._configurationService.getValue<boolean>('interpreters.restartOnCrash');

		let action;

		if (restartOnCrash) {
			// Wait a beat, then start the runtime.
			await new Promise<void>(resolve => setTimeout(resolve, 250));

			await this._runtimeSessionService.restartSession(
				session.sessionId,
				`The runtime exited unexpectedly and is being restarted automatically.`
			);

			action = 'and was automatically restarted';
		} else {
			// If we're not going to restart, clean up the Ext Host.
			action = 'and was not automatically restarted';
		}

		// Let the user know what we did.
		const msg = nls.localize(
			'positronConsole.runtimeCrashed',
			'{0} exited unexpectedly {1}. You may have lost unsaved work.\nExit code: {2}',
			session.runtimeMetadata.runtimeName,
			action,
			exit.exit_code
		);

		this._notificationService.prompt(Severity.Warning, msg, [
			{
				label: nls.localize('openOutputLogs', 'Open Logs'),
				run: () => {
					session.showOutput();
				}
			},
		]);

		// If we didn't restart the session, we need to clean it up.
		return !restartOnCrash;
	}

	/**
	 * Gets the storage key used to store the set of workspace sessions in
	 * ephemeral storage.
	 */
	private getEphemeralWorkspaceSessionsKey(): string {
		// We include the workspace ID in the key since ephemeral storage can
		// be shared among workspaces in e.g. Positron Server.
		return `${PERSISTENT_WORKSPACE_SESSIONS}.${this._workspaceContextService.getWorkspace().id}`;
	}

	/**
	 * Gets the startup behavior for a language.
	 *
	 * @param languageId The language ID for which to get the startup behavior.
	 * @returns The startup behavior for the language.
	 */
	private getStartupBehavior(languageId: string): LanguageStartupBehavior {
		return this._configurationService.getValue(
			'interpreters.startupBehavior', { overrideIdentifier: languageId });
	}


	/**
	 * Fires the main startup sequence, possibly after waiting for the
	 * workspace to be trusted.
	 */
	private async startupAfterTrust(): Promise<void> {
		// Wait for workspace trust to finish initializing before deciding
		// whether we can proceed. All workspaces open untrusted and may
		// transition to trusted during startup, so checking trust before it is
		// initialized could incorrectly enter the AwaitingTrust phase.
		await this._workspaceTrustManagementService.workspaceTrustInitialized;

		if (this._workspaceTrustManagementService.isWorkspaceTrusted()) {
			// In a trusted workspace, we can start the startup sequence
			// immediately.
			await this.startupSequence();
		} else {
			// If we are not in a trusted workspace, wait for the workspace to become
			// trusted before starting the startup sequence.
			this.setStartupPhase(RuntimeStartupPhase.AwaitingTrust);
			this._register(this._workspaceTrustManagementService.onDidChangeTrust((trusted) => {
				if (!trusted) {
					return;
				}
				// If the workspace becomse trusted while we are awaiting trust,
				// move on to the startup sequence.
				if (this._startupPhase === RuntimeStartupPhase.AwaitingTrust) {
					this.startupSequence();
				}
			}));
		}
	}

	/**
	 * Starts a new runtime session from implicit state.
	 */
	private async autoStartRuntime(
		metadata: ILanguageRuntimeMetadata,
		source: string,
		activate: boolean
	) {
		this._onWillAutoStartRuntime.fire({
			runtime: metadata,
			newSession: true,
			activate
		});
		await this._runtimeSessionService.autoStartRuntime(metadata, source, activate);
	}

	// Storage key prefix for architecture mismatch dismissal
	private readonly _archMismatchStorageKeyPrefix = 'interpreter.dismissedArchMismatch';

	/**
	 * Checks if the interpreter architecture differs from the system architecture
	 * and shows a warning notification if so.
	 */
	private checkArchitectureMismatch(
		session: ILanguageRuntimeSession,
		runtimeInfo: { interpreterArch?: LanguageRuntimeArchitecture }
	): void {
		// Skip on web - the browser's architecture doesn't relate to where
		// the interpreter is running
		if (isWeb) {
			return;
		}

		// Skip on remote sessions - Linux remotes don't have architecture emulation,
		// and comparing interpreter arch against the local client arch is meaningless
		if (this._environmentService.remoteAuthority) {
			return;
		}

		const interpreterArch = runtimeInfo.interpreterArch;
		if (!interpreterArch || !systemArch) {
			return;
		}

		// Don't warn for "Other" architectures; we only care about arm64/x64 mismatches
		if (interpreterArch === LanguageRuntimeArchitecture.Other) {
			return;
		}

		// Compare the enum value (which is a string like 'arm64' or 'x64') with process.arch
		if (systemArch !== interpreterArch) {
			this.showArchitectureMismatchWarning(
				session.runtimeMetadata.languageId,
				session.runtimeMetadata.runtimeName,
				systemArch,
				interpreterArch
			);
		}
	}

	/**
	 * Shows a notification warning when an interpreter's architecture doesn't
	 * match the system architecture.
	 */
	private showArchitectureMismatchWarning(
		languageId: string,
		runtimeName: string,
		systemArchValue: string,
		interpreterArch: LanguageRuntimeArchitecture
	): void {
		// Check if user has permanently dismissed for this language
		const storageKey = `${this._archMismatchStorageKeyPrefix}.${languageId}`;
		const dismissed = this._storageService.getBoolean(storageKey, StorageScope.PROFILE, false);
		if (dismissed) {
			return;
		}

		// Capitalize language name for display
		const languageDisplayName = languageId === 'r' ? 'R' : languageId.charAt(0).toUpperCase() + languageId.slice(1);

		// Show sticky notification
		this._notificationService.prompt(
			Severity.Warning,
			nls.localize(
				'positron.runtime.archMismatch',
				'The interpreter "{0}" has a different architecture ({1}) than your system ({2}). This may cause problems with performance and package compatibility.',
				runtimeName,
				interpreterArch,
				systemArchValue
			),
			[
				{
					label: nls.localize('positron.runtime.archMismatch.dismiss', "Don't show again for {0}", languageDisplayName),
					run: () => {
						this._storageService.store(storageKey, true, StorageScope.PROFILE, StorageTarget.USER);
					}
				}
			],
			{
				sticky: true
			}
		);
	}

	/**
	 * Resets the architecture mismatch warning dismissal for a specific language
	 * or all languages.
	 */
	public resetArchitectureMismatchWarning(languageId?: string): void {
		if (languageId) {
			// Reset for specific language
			const storageKey = `${this._archMismatchStorageKeyPrefix}.${languageId}`;
			this._storageService.remove(storageKey, StorageScope.PROFILE);
		} else {
			// Reset for all languages by finding and removing all matching keys
			const keys = this._storageService.keys(StorageScope.PROFILE, StorageTarget.USER);
			for (const key of keys) {
				if (key.startsWith(this._archMismatchStorageKeyPrefix)) {
					this._storageService.remove(key, StorageScope.PROFILE);
				}
			}
		}
	}
}

registerSingleton(IRuntimeStartupService, RuntimeStartupService, InstantiationType.Eager);
