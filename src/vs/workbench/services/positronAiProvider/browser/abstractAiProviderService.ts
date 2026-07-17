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
 * The catalog-mirroring core: warms a synchronous snapshot from the node-side
 * catalog, keeps it current from change events, and answers reads over the
 * cached map. Environment specifics come from the subclasses; registrations
 * live in the sibling variant files so importing this base registers nothing.
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
		// Defer the first fetch off the super() stack: createCatalogClient() reads
		// subclass parameter-properties not yet assigned while the base constructor
		// runs, so a synchronous call here would throw and strand status 'error'.
		this.whenInitialized = Promise.resolve().then(() => this.initialize());
	}

	private async initialize(): Promise<void> {
		try {
			const client = this.getClient();
			if (!client) {
				throw new Error('No AI provider catalog channel available');
			}
			let receivedChange = false;
			this._register(client.onDidChangeCatalog(change => {
				receivedChange = true;
				this.setSnapshot(change.catalog);
				this._onDidChangeProviders.fire(change);
			}));
			const initial = await client.getCatalog();
			// Don't let the stale initial load overwrite a change that raced it.
			if (!receivedChange) {
				this.setSnapshot(initial);
			}
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
 * Warms the catalog at startup: injecting the delayed {@link IAiProviderService}
 * singleton instantiates it, which kicks off the initial fetch before provider
 * UI runs. Class only (no registration) so each variant registers its own.
 */
export class AiProviderServiceWarmer implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronAiProviderWarmer';
	constructor(@IAiProviderService _aiProviderService: IAiProviderService) { }
}
