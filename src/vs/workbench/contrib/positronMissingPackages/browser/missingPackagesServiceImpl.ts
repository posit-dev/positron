/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { hash } from '../../../../base/common/hash.js';
import { Disposable, DisposableMap, IDisposable } from '../../../../base/common/lifecycle.js';
import { LRUCache, ResourceMap } from '../../../../base/common/map.js';
import { URI } from '../../../../base/common/uri.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IPositronPackagesService } from '../../positronPackages/browser/interfaces/positronPackagesService.js';
import { IPackageSpec, IRuntimeMissingPackage, IRuntimeMissingPackagesTarget, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IMissingPackagesGroup, IMissingPackagesResult, IMissingPackagesService } from '../common/missingPackagesService.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { CellKind } from '../../notebook/common/notebookCommon.js';

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
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Invalidate a session's cached results when its packages change.
		this._syncPackageListeners();
		this._register(this._packagesService.onDidChangeActivePackagesInstance(() => this._syncPackageListeners()));

		// A new or removed session, or a foreground-session change, can change
		// which session analyzes a resource; invalidate broadly so the next
		// request recomputes against the right session.
		this._register(this._runtimeSessionService.onWillStartSession(() => this._invalidateAll()));
		this._register(this._runtimeSessionService.onDidChangeForegroundSession(() => this._invalidateAll()));
		this._register(this._runtimeSessionService.onDidDeleteRuntimeSession(sessionId => this._invalidateSession(sessionId)));
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
		try {
			for (const group of result.groups) {
				try {
					await this.install(group);
				} catch (err) {
					this._logService.warn(`[MissingPackages] install failed for session '${group.sessionId}': ${err}`);
				}
			}
		} finally {
			this._installing.delete(result.resource);
			this._onDidChangeInstalling.fire(result.resource);
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

		// Script / single-language text document: read the open text model.
		const model = this._modelService.getModel(resource);
		if (!model) {
			return undefined;
		}
		return this._buildScriptTargets(model.getLanguageId(), model.getValue());
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
				const model = ref.object.textEditorModel;
				return this._buildScriptTargets(model.getLanguageId(), model.getValue());
			} finally {
				ref.dispose();
			}
		} catch (err) {
			this._logService.trace(`[MissingPackages] Could not resolve content for ${resource.toString()}: ${err}`);
			return [];
		}
	}

	/**
	 * Builds the analysis targets for a single-language chunk of code. Multi-
	 * language documents (e.g. quarto) will produce one target per language.
	 */
	private _buildScriptTargets(languageId: string, content: string): IResolvedTarget[] {
		const session = this._runtimeSessionService.getConsoleSessionForLanguage(languageId);
		if (!session || !session.listMissingPackages) {
			return [];
		}
		const cacheKey = `${session.sessionId}:${hash(content)}`;
		return [{ sessionId: session.sessionId, languageId, cacheKey, target: { code: content } }];
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
		try {
			const session = this._runtimeSessionService.getSession(target.sessionId);
			// Use no cancellation here: the result is shared across callers, so a
			// single caller's cancellation must not abort it.
			const result = session?.listMissingPackages
				? await session.listMissingPackages(target.target, CancellationToken.None)
				: [];
			this._cache.set(target.cacheKey, result);
			return result;
		} catch (err) {
			this._logService.warn(`[MissingPackages] listMissingPackages failed for session '${target.sessionId}': ${err}`);
			return [];
		} finally {
			this._inFlight.delete(target.cacheKey);
		}
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

	/** Clears cached results for a session and notifies affected resources. */
	private _invalidateSession(sessionId: string): void {
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
		this._cache.clear();
		for (const [resource] of this._resources) {
			this._onDidChangeMissingPackages.fire(resource);
		}
	}

	//#endregion Private helpers
}
