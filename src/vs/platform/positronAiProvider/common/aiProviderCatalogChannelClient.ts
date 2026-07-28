/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IAiProviderCatalog, IProviderCatalogChangeData, IResolvedProviderData } from './aiProviderCatalog.js';

/** Implements {@link IAiProviderCatalog} over an IPC {@link IChannel}. */
export class AiProviderCatalogChannelClient implements IAiProviderCatalog {

	constructor(private readonly _channel: IChannel) { }

	readonly onDidChangeCatalog: Event<IProviderCatalogChangeData> = this._channel.listen('onDidChangeCatalog');

	getCatalog(): Promise<readonly IResolvedProviderData[]> {
		return this._channel.call('getCatalog');
	}

	async getConfigFileUri(): Promise<URI> {
		return URI.revive(await this._channel.call<UriComponents>('getConfigFileUri'));
	}
}
