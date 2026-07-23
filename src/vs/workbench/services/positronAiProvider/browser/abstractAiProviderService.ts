/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IAiProviderCatalog, IProviderCatalogChangeData, IResolvedProviderData } from '../../../../platform/positronAiProvider/common/aiProviderCatalog.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { AiProviderServiceStatus, IAiProviderService } from '../common/aiProviderService.js';

/**
 * The catalog-mirroring core: it warms a synchronous snapshot from the node-side
 * catalog, keeps it current from change events, and answers reads over the
 * cached map. It is environment-agnostic and depends only on the catalog port
 * ({@link createCatalogClient}) and the remote authority ({@link remoteAuthority}),
 * which are exactly what the interface tests fake.
 *
 * The concrete subclasses (and their service registrations) live in sibling
 * files so importing this base never registers a service.
 */
export abstract class AbstractAiProviderService extends Disposable implements IAiProviderService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeProviders = this._register(new Emitter<IProviderCatalogChangeData>());
	readonly onDidChangeProviders: Event<IProviderCatalogChangeData> = this._onDidChangeProviders.event;

	private _snapshot: readonly IResolvedProviderData[] = [];
	private _byId = new Map<string, IResolvedProviderData>();
	private _status: AiProviderServiceStatus = 'initializing';
	private _lastError: Error | undefined;
	private _client: IAiProviderCatalog | undefined;
	readonly whenInitialized: Promise<void>;

	/** Create the catalog client for this environment, or `undefined` if none is reachable. */
	protected abstract createCatalogClient(): IAiProviderCatalog | undefined;

	/** The remote authority when connected to one, else `undefined` (local desktop). */
	protected abstract remoteAuthority(): string | undefined;

	constructor(protected readonly _logService: ILogService) {
		super();
		// Defer the first fetch off the constructor stack: createCatalogClient()
		// reads subclass parameter-properties (_remoteAgentService /
		// _sharedProcessService) that are NOT yet assigned while this base
		// constructor runs during super() -- the same hazard
		// abstractHeadlessLanguageModelService.ts documents (it creates its engine
		// lazily for this reason). A synchronous initialize() here would TypeError,
		// get swallowed by its own catch, and leave every window in permanent
		// status 'error' with an empty snapshot.
		this.whenInitialized = Promise.resolve().then(() => this.initialize());
	}

	private async initialize(): Promise<void> {
		try {
			const client = this.getClient();
			if (!client) {
				throw new Error('No AI provider catalog channel available');
			}
			this._register(client.onDidChangeCatalog(change => {
				this.setSnapshot(change.catalog);
				this._onDidChangeProviders.fire(change);
			}));
			this.setSnapshot(await client.getCatalog());
			this._status = 'ready';
		} catch (error) {
			this._status = 'error';
			this._lastError = error instanceof Error ? error : new Error(String(error));
			this._logService.error('[AI Provider Service] initial catalog fetch failed', error);
			// Keep whatever snapshot we have (empty on first failure); never reject.
		}
	}

	/** Lazily create the catalog client, retrying creation while it stays absent. */
	private getClient(): IAiProviderCatalog | undefined {
		return this._client ??= this.createCatalogClient();
	}

	private setSnapshot(catalog: readonly IResolvedProviderData[]): void {
		this._snapshot = catalog;
		this._byId = new Map(catalog.map(p => [p.id, p]));
		this._status = 'ready'; // a live update also recovers from 'error'
	}

	get status(): AiProviderServiceStatus { return this._status; }
	get lastError(): Error | undefined { return this._lastError; }
	getProvider(id: string): IResolvedProviderData | undefined { return this._byId.get(id); }
	isEnabled(id: string): boolean { return this._byId.get(id)?.enabled === true; }
	getProviders(): readonly IResolvedProviderData[] { return this._snapshot; }

	async getConfigFileUri(): Promise<URI> {
		const client = this.getClient();
		if (!client) {
			throw new Error('No AI provider catalog channel available');
		}
		// The catalog returns a file:// URI on its host; re-home it onto the
		// remote authority when connected (the path is already encoded).
		const uri = await client.getConfigFileUri();
		const authority = this.remoteAuthority();
		return authority ? uri.with({ scheme: Schemas.vscodeRemote, authority }) : uri;
	}
}

/**
 * Instantiating the delayed {@link IAiProviderService} singleton kicks off the
 * initial catalog fetch, so this contribution injects it once at startup to warm
 * the snapshot before provider UI runs. Lives here (class only, no registration)
 * so both variants register it against their own singleton.
 */
export class AiProviderServiceWarmer implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronAiProviderWarmer';
	constructor(@IAiProviderService _aiProviderService: IAiProviderService) {
		// Injection alone instantiates the delayed singleton, which kicks off the
		// initial catalog fetch before provider UI can run.
	}
}
