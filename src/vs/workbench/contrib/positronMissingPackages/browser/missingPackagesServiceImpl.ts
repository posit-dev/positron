/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { hash } from '../../../../base/common/hash.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { LRUCache, ResourceMap } from '../../../../base/common/map.js';
import { URI } from '../../../../base/common/uri.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IPositronPackagesService } from '../../positronPackages/browser/interfaces/positronPackagesService.js';
import { IPackageSpec, IRuntimeMissingPackage, IRuntimeMissingPackagesTarget, IRuntimeSessionService, ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IMissingPackagesGroup, IMissingPackagesResult, IMissingPackagesService } from '../common/missingPackagesService.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { CellKind } from '../../notebook/common/notebookCommon.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IQuartoDocumentModelService } from '../../positronQuarto/browser/quartoDocumentModelService.js';
import { QUARTO_LANGUAGE_IDS, usingQuartoInlineOutput } from '../../positronQuarto/common/positronQuartoConfig.js';

/**
 * The maximum number of per-session results to retain in the cache. Old entries
 * (e.g. earlier content hashes for an edited file) age out by LRU.
 */
const CACHE_LIMIT = 50;

/**
 * A target resolved from a resource: the session that should analyze a chunk of
 * code, plus the cache key under which its result is stored.
 */
interface IResolvedTarget {
	readonly sessionId: string;
	readonly languageId: string;
	readonly cacheKey: string;
	readonly target: IRuntimeMissingPackagesTarget;
}

/**
 * Frontend implementation of {@link IMissingPackagesService}.
 */
export class MissingPackagesService extends Disposable implements IMissingPackagesService {
	declare readonly _serviceBrand: undefined;

	/** Per-session results keyed by `${sessionId}:${contentHash}`. */
	private readonly _cache = new LRUCache<string, IRuntimeMissingPackage[]>(CACHE_LIMIT);

	/** In-flight computations, deduped by cache key. */
	private readonly _inFlight = new Map<string, Promise<IRuntimeMissingPackage[]>>();

	/**
	 * Invalidation generations. A compute captures these when it starts and only
	 * commits its result to the cache if they are unchanged when it finishes, so a
	 * computation that was in flight across an invalidation cannot repopulate the
	 * cache with a now-stale result. `_globalGeneration` bumps on a full
	 * invalidation; `_sessionGenerations` bump per session.
	 */
	private _globalGeneration = 0;
	private readonly _sessionGenerations = new Map<string, number>();

	/** The last-resolved targets per resource, so invalidation can find affected resources. */
	private readonly _resources = new ResourceMap<IResolvedTarget[]>();

	/** Resources currently installing, holding the snapshot captured at start. */
	private readonly _installing = new ResourceMap<IMissingPackagesResult>();

	/** Per-session listeners on package-change events, keyed by sessionId. */
	private readonly _packageListeners = this._register(new DisposableMap<string, IDisposable>());

	private readonly _onDidChangeMissingPackages = this._register(new Emitter<URI>());
	readonly onDidChangeMissingPackages: Event<URI> = this._onDidChangeMissingPackages.event;

	private readonly _onDidChangeInstalling = this._register(new Emitter<URI>());
	readonly onDidChangeInstalling: Event<URI> = this._onDidChangeInstalling.event;

	constructor(
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IPositronPackagesService private readonly _packagesService: IPositronPackagesService,
		@IModelService private readonly _modelService: IModelService,
		@ITextModelService private readonly _textModelService: ITextModelService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IQuartoDocumentModelService private readonly _quartoDocumentModelService: IQuartoDocumentModelService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Invalidate a session's cached results when its packages change.
		this._syncPackageListeners();
		this._register(this._packagesService.onDidChangeActivePackagesInstance(() => this._syncPackageListeners()));

		// A new or removed session can change which session analyzes a resource;
		// invalidate broadly so the next request recomputes against the right
		// session.
		this._register(this._runtimeSessionService.onWillStartSession(() => this._invalidateAll()));
		this._register(this._runtimeSessionService.onDidDeleteRuntimeSession(sessionId => {
			this._invalidateSession(sessionId);
			// Drop the now-dead session's package listener and generation entry so
			// per-session bookkeeping doesn't grow across many session start/stops.
			this._packageListeners.deleteAndDispose(sessionId);
			this._sessionGenerations.delete(sessionId);
		}));

		// Prune a resource's tracked targets when its model goes away (editor
		// closed / notebook removed), so resource bookkeeping and the invalidation
		// fan-out don't grow without bound over a long-lived window.
		this._register(this._modelService.onModelRemoved(model => this._resources.delete(model.uri)));
		this._register(this._notebookService.onDidRemoveNotebookDocument(notebook => this._resources.delete(notebook.uri)));

		// A foreground-session change reroutes a resource to a different session,
		// but the cached results for each session are still valid (a session's
		// package set doesn't change because focus moved). Only notify resources
		// to re-resolve their targets -- re-resolution hits the cache for the now-
		// foreground session, so flipping between sessions doesn't re-run the
		// (RPC-backed) analysis every time.
		this._register(this._runtimeSessionService.onDidChangeForegroundSession(() => this._notifyAllResources()));
	}

	getCached(resource: URI): IMissingPackagesResult | undefined {
		const targets = this._resolveTargetsSync(resource);
		if (!targets) {
			return undefined;
		}
		const groups: IMissingPackagesGroup[] = [];
		for (const target of targets) {
			const packages = this._cache.get(target.cacheKey);
			if (!packages) {
				// Not all targets are computed yet; report nothing rather than work.
				return undefined;
			}
			if (packages.length > 0) {
				groups.push({ sessionId: target.sessionId, languageId: target.languageId, packages });
			}
		}
		return this._composeResult(resource, groups);
	}

	async ensure(resource: URI, token?: CancellationToken): Promise<IMissingPackagesResult> {
		const targets = await this._resolveTargets(resource);
		this._resources.set(resource, targets);

		const groups: IMissingPackagesGroup[] = [];
		for (const target of targets) {
			const packages = await this._computeTarget(target);
			if (packages.length > 0) {
				groups.push({ sessionId: target.sessionId, languageId: target.languageId, packages });
			}
		}
		return this._composeResult(resource, groups);
	}

	analyzeCode(sessionId: string, code: string, token?: CancellationToken): Promise<IRuntimeMissingPackage[]> {
		const session = this._runtimeSessionService.getSession(sessionId);
		if (!session?.listMissingPackages) {
			return Promise.resolve([]);
		}
		// Build a synthetic target for this session + code and run it through the
		// same compute path as resource-based analysis, so the console-error
		// onramp shares the cache, in-flight dedupe, and resilience guards.
		const target: IResolvedTarget = {
			sessionId,
			languageId: session.runtimeMetadata.languageId,
			cacheKey: `${sessionId}:${hash(code)}`,
			target: { code },
		};
		return this._computeTarget(target);
	}

	async install(group: IMissingPackagesGroup, token?: CancellationToken): Promise<void> {
		const specs: IPackageSpec[] = group.packages.map(pkg => ({ name: pkg.name }));

		// Prefer the packages instance for its busy state and change events.
		const instance = this._packagesService.getInstances().find(i => i.session.sessionId === group.sessionId);
		if (instance) {
			await instance.installPackages(specs, token);
		} else {
			const session = this._runtimeSessionService.getSession(group.sessionId);
			const packageManager = session?.getPackageManager?.();
			if (!packageManager) {
				throw new Error(`Cannot install packages: session '${group.sessionId}' has no package manager.`);
			}
			await packageManager.installPackages(specs, token);
		}

		// Clear stale cache for this session even when no instance event fires.
		this._invalidateSession(group.sessionId);
	}

	async installAll(result: IMissingPackagesResult): Promise<void> {
		// Mark the resource as installing before the first await so synchronous
		// callers (e.g. the badge) observe the state change immediately.
		this._installing.set(result.resource, result);
		this._onDidChangeInstalling.fire(result.resource);

		// Install every group, continuing past a failed group so the rest still
		// install. The first failure is remembered and rethrown once the state has
		// been cleaned up, so callers can surface it.
		let firstError: unknown;
		try {
			for (const group of result.groups) {
				try {
					await this.install(group);
				} catch (err) {
					firstError ??= err;
					this._logService.warn(`[MissingPackages] install failed for session '${group.sessionId}': ${err}`);
				}
			}

			// Recompute before clearing the installing flag so the post-install
			// result is cached and available synchronously the moment the flag
			// clears. Without this the badge briefly reverts to the pre-install
			// "missing" state while the recompute is still in flight.
			try {
				await this.ensure(result.resource);
			} catch {
				// Best effort; the next read will recompute.
			}
		} finally {
			this._installing.delete(result.resource);
			this._onDidChangeInstalling.fire(result.resource);
		}

		if (firstError !== undefined) {
			throw firstError;
		}
	}

	getInstalling(resource: URI): IMissingPackagesResult | undefined {
		return this._installing.get(resource);
	}

	//#region Private helpers

	/**
	 * Resolves the targets for a resource using only synchronous sources (an
	 * open text model). Returns undefined when content is not synchronously
	 * available, so `getCached` callers never block.
	 */
	private _resolveTargetsSync(resource: URI): IResolvedTarget[] | undefined {
		// Notebook: read code cells from the in-memory notebook model and route
		// them to the notebook's kernel session (not the foreground console
		// session). The model is available synchronously whenever the notebook
		// is open, which is the only case the badge cares about.
		const notebook = this._notebookService.getNotebookTextModel(resource);
		if (notebook) {
			return this._buildNotebookTargets(resource, notebook);
		}

		// Script / single-language text document (or a Quarto document, which is
		// split per-language below): read the open text model.
		const model = this._modelService.getModel(resource);
		if (!model) {
			return undefined;
		}
		return this._buildTextModelTargets(model);
	}

	/**
	 * Resolves the targets for a resource, reading content asynchronously when
	 * it is not already available from an open model.
	 */
	private async _resolveTargets(resource: URI): Promise<IResolvedTarget[]> {
		const sync = this._resolveTargetsSync(resource);
		if (sync) {
			return sync;
		}
		try {
			const ref = await this._textModelService.createModelReference(resource);
			try {
				return this._buildTextModelTargets(ref.object.textEditorModel);
			} finally {
				ref.dispose();
			}
		} catch (err) {
			this._logService.trace(`[MissingPackages] Could not resolve content for ${resource.toString()}: ${err}`);
			return [];
		}
	}

	/**
	 * Builds the analysis targets for an open text model, dispatching on its
	 * language. Quarto documents are multi-language and produce one target per
	 * language; everything else is treated as a single-language script.
	 */
	private _buildTextModelTargets(model: ITextModel): IResolvedTarget[] {
		const languageId = model.getLanguageId();
		if (QUARTO_LANGUAGE_IDS.includes(languageId)) {
			return this._buildQuartoTargets(model);
		}
		return this._buildScriptTargets(languageId, model.getValue(), model.uri);
	}

	/**
	 * Builds the analysis targets for a Quarto document. The document is parsed
	 * into code cells grouped by language; how those groups map to sessions
	 * depends on the execution mode:
	 *
	 * - With inline output, the document executes in its own per-document
	 *   session (a notebook-mode session keyed by the document URI), exactly
	 *   like a notebook. The chunks for that session's language are routed to it
	 *   so packages install into the document's session, not a shared console.
	 * - Without inline output, the chunks execute in the shared per-language
	 *   console sessions, so each language's chunks are routed to its console
	 *   session (the original behavior).
	 *
	 * Languages without a usable session (or without `listMissingPackages`
	 * support) are skipped; the cache invalidates on session start, so the badge
	 * recomputes once a session is available.
	 */
	private _buildQuartoTargets(model: ITextModel): IResolvedTarget[] {
		const quartoModel = this._quartoDocumentModelService.getModel(model);

		// Group cell code by language. Languages are normalized to lower case to
		// match runtime language ids (e.g. a `{R}` fence maps to the `r` runtime).
		const codeByLanguage = new Map<string, string[]>();
		for (const cell of quartoModel.cells) {
			const languageId = cell.language.toLowerCase();
			const chunks = codeByLanguage.get(languageId);
			if (chunks) {
				chunks.push(quartoModel.getCellCode(cell));
			} else {
				codeByLanguage.set(languageId, [quartoModel.getCellCode(cell)]);
			}
		}

		// Inline output: route the document session's language to that session.
		if (usingQuartoInlineOutput(this._configurationService)) {
			const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(model.uri);
			if (!session || !session.listMissingPackages) {
				// No per-document session yet; recompute once one starts.
				return [];
			}
			const languageId = session.runtimeMetadata.languageId;
			const chunks = codeByLanguage.get(languageId);
			if (!chunks || chunks.length === 0) {
				return [];
			}
			const code = chunks.join('\n');
			const cacheKey = `${session.sessionId}:${hash(code)}`;
			return [{ sessionId: session.sessionId, languageId, cacheKey, target: { code } }];
		}

		// Console output: route each language's chunks to its console session.
		const targets: IResolvedTarget[] = [];
		for (const [languageId, chunks] of codeByLanguage) {
			const session = this._runtimeSessionService.getConsoleSessionForLanguage(languageId);
			if (!session || !session.listMissingPackages) {
				continue;
			}
			const code = chunks.join('\n');
			const cacheKey = `${session.sessionId}:${hash(code)}`;
			targets.push({ sessionId: session.sessionId, languageId, cacheKey, target: { code } });
		}
		return targets;
	}

	/**
	 * Builds the analysis targets for a single-language chunk of code. The source
	 * URI, when known, is forwarded so the runtime can treat the file's directory
	 * as an import root and avoid flagging local modules (a sibling `helper`
	 * package) as missing packages. The live model text is still sent as `code`
	 * so unsaved edits are analyzed.
	 */
	private _buildScriptTargets(languageId: string, content: string, uri?: URI): IResolvedTarget[] {
		const session = this._runtimeSessionService.getConsoleSessionForLanguage(languageId);
		if (!session || !session.listMissingPackages) {
			return [];
		}
		const cacheKey = `${session.sessionId}:${hash(content)}`;
		return [{ sessionId: session.sessionId, languageId, cacheKey, target: { code: content, uri: uri?.toString() } }];
	}

	/**
	 * Builds the analysis target for a notebook. A notebook is analyzed by its
	 * kernel session rather than the foreground console session: the code cells
	 * that match the kernel's language are concatenated and sent to that
	 * session. Returns nothing when the notebook has no running kernel session
	 * yet (the cache invalidates on session start, so the badge recomputes once
	 * a kernel is available).
	 */
	private _buildNotebookTargets(notebookUri: URI, notebook: NotebookTextModel): IResolvedTarget[] {
		const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		if (!session || !session.listMissingPackages) {
			return [];
		}
		const languageId = session.runtimeMetadata.languageId;
		const code = notebook.cells
			.filter(cell => cell.cellKind === CellKind.Code && cell.language === languageId)
			.map(cell => cell.getValue())
			.join('\n');
		if (!code.trim()) {
			return [];
		}
		const cacheKey = `${session.sessionId}:${hash(code)}`;
		return [{ sessionId: session.sessionId, languageId, cacheKey, target: { code } }];
	}

	/**
	 * Computes (or returns the cached) result for a single target, deduping any
	 * concurrent computation by cache key.
	 */
	private _computeTarget(target: IResolvedTarget): Promise<IRuntimeMissingPackage[]> {
		const cached = this._cache.get(target.cacheKey);
		if (cached) {
			return Promise.resolve(cached);
		}
		let inFlight = this._inFlight.get(target.cacheKey);
		if (!inFlight) {
			inFlight = this._doCompute(target);
			this._inFlight.set(target.cacheKey, inFlight);
		}
		return inFlight;
	}

	private async _doCompute(target: IResolvedTarget): Promise<IRuntimeMissingPackage[]> {
		// Capture the invalidation generations at the start. If either changes
		// while the (RPC-backed) analysis is in flight, the result is stale and
		// must not be cached -- otherwise an invalidation that happened mid-flight
		// (e.g. a package was installed) would be silently undone by this late
		// write under the same content-keyed cache entry.
		const globalGeneration = this._globalGeneration;
		const sessionGeneration = this._sessionGeneration(target.sessionId);
		try {
			const session = this._runtimeSessionService.getSession(target.sessionId);
			if (!session?.listMissingPackages) {
				return [];
			}

			// Don't analyze a session that is shutting down or already gone; the
			// RPC would never come back.
			const state = session.getRuntimeState();
			if (state === RuntimeState.Exiting || state === RuntimeState.Exited || state === RuntimeState.Offline) {
				return [];
			}

			// Use no cancellation here: the result is shared across callers, so a
			// single caller's cancellation must not abort it. But race against the
			// session ending so a session that exits (e.g. fails to start) while the
			// analysis is in flight resolves to an empty result rather than leaving
			// the computation -- and any progress UI awaiting it -- pending forever.
			const result = await this._raceSessionEnd(session, session.listMissingPackages(target.target, CancellationToken.None));
			if (this._globalGeneration === globalGeneration &&
				this._sessionGeneration(target.sessionId) === sessionGeneration) {
				this._cache.set(target.cacheKey, result);
			}
			return result;
		} catch (err) {
			this._logService.warn(`[MissingPackages] listMissingPackages failed for session '${target.sessionId}': ${err}`);
			return [];
		} finally {
			this._inFlight.delete(target.cacheKey);
		}
	}

	/**
	 * Resolves with the analysis result, or with an empty result if the session
	 * ends first. Guards against a session whose RPC never returns because it
	 * failed to start or exited mid-analysis.
	 */
	private _raceSessionEnd(session: ILanguageRuntimeSession, analysis: Thenable<IRuntimeMissingPackage[]>): Promise<IRuntimeMissingPackage[]> {
		return new Promise<IRuntimeMissingPackage[]>((resolve, reject) => {
			const store = new DisposableStore();
			store.add(session.onDidEndSession(() => { store.dispose(); resolve([]); }));
			Promise.resolve(analysis).then(
				result => { store.dispose(); resolve(result); },
				err => { store.dispose(); reject(err); });
		});
	}

	private _composeResult(resource: URI, groups: IMissingPackagesGroup[]): IMissingPackagesResult {
		const total = groups.reduce((sum, group) => sum + group.packages.length, 0);
		return { resource, groups, total };
	}

	/** Attaches package-change listeners to any sessions not yet tracked. */
	private _syncPackageListeners(): void {
		for (const instance of this._packagesService.getInstances()) {
			const sessionId = instance.session.sessionId;
			if (!this._packageListeners.has(sessionId)) {
				this._packageListeners.set(sessionId, instance.onDidChangePackages(() => this._invalidateSession(sessionId)));
			}
		}
	}

	/** The current invalidation generation for a session (0 if never invalidated). */
	private _sessionGeneration(sessionId: string): number {
		return this._sessionGenerations.get(sessionId) ?? 0;
	}

	/** Clears cached results for a session and notifies affected resources. */
	private _invalidateSession(sessionId: string): void {
		// Bump the session's generation so any in-flight compute for it discards
		// its (now-stale) result rather than re-caching it after this clear.
		this._sessionGenerations.set(sessionId, this._sessionGeneration(sessionId) + 1);

		const prefix = `${sessionId}:`;
		for (const key of [...this._cache.keys()]) {
			if (key.startsWith(prefix)) {
				this._cache.delete(key);
			}
		}
		for (const [resource, targets] of this._resources) {
			if (targets.some(target => target.sessionId === sessionId)) {
				this._onDidChangeMissingPackages.fire(resource);
			}
		}
	}

	/** Clears the entire cache and notifies every tracked resource. */
	private _invalidateAll(): void {
		// Bump the global generation so any in-flight compute discards its result
		// rather than re-caching it after this clear.
		this._globalGeneration++;
		this._cache.clear();
		this._notifyAllResources();
	}

	/**
	 * Notifies every tracked resource to re-read its result without clearing the
	 * cache. Used when the mapping from resource to session may have changed (a
	 * foreground-session switch) but the cached per-session results are still
	 * valid.
	 */
	private _notifyAllResources(): void {
		for (const [resource] of this._resources) {
			this._onDidChangeMissingPackages.fire(resource);
		}
	}

	//#endregion Private helpers
}
