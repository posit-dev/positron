/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IAiProviderCatalog } from '../common/aiProviderCatalog.js';

/** Exposes a {@link IAiProviderCatalog} over an IPC channel. */
export class AiProviderCatalogChannel implements IServerChannel {

	constructor(private readonly _catalog: IAiProviderCatalog) { }

	listen<T>(_ctx: unknown, event: string): Event<T> {
		switch (event) {
			case 'onDidChangeCatalog':
				return this._catalog.onDidChangeCatalog as Event<unknown> as Event<T>;
		}
		throw new Error(`Unknown event: ${event}`);
	}

	call<T>(_ctx: unknown, command: string): Promise<T> {
		switch (command) {
			case 'getCatalog':
				return this._catalog.getCatalog() as Promise<T>;
			case 'getConfigFilePath':
				return this._catalog.getConfigFilePath() as Promise<T>;
		}
		throw new Error(`Unknown command: ${command}`);
	}
}
