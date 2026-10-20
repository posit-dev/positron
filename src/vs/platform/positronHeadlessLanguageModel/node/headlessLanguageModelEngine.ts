/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncIterableObject } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { IEngineChatRequest, IHeadlessLanguageModelEngine, IModelListing, IProviderMapping, IProviderModuleSource } from '../common/engine.js';
import { HeadlessProviderModule } from './headlessProviderModule.js';

/**
 * The Node-side egress engine: forwards each call to the process's provider
 * module, which owns provider mappings, credential shaping, model policy and
 * the network. Runs in the shared process (desktop) or the remote server
 * (Remote SSH / web) and is reached over an IPC channel.
 */
export class HeadlessLanguageModelEngine implements IHeadlessLanguageModelEngine {

	constructor(private readonly _module: HeadlessProviderModule) { }

	async getProviderMappings(): Promise<IProviderMapping[]> {
		return (await this._module.get()).providers.getProviderMappings();
	}

	async listModels(providerId: string, sessionToken: string | undefined): Promise<IModelListing> {
		return (await this._module.get()).providers.listModels(providerId, sessionToken);
	}

	streamChat(request: IEngineChatRequest, token: CancellationToken): AsyncIterable<string> {
		return new AsyncIterableObject<string>(async emitter => {
			const { providers } = await this._module.get();
			for await (const delta of providers.streamChat(request, token)) {
				emitter.emitOne(delta);
			}
		});
	}

	async getProviderModuleSource(): Promise<IProviderModuleSource> {
		return (await this._module.get()).source;
	}
}
