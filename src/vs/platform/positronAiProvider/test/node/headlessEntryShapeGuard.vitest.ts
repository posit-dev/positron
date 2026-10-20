/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type {
	HeadlessCatalogChange,
	HeadlessChatRequest,
	HeadlessModel,
	HeadlessModelListing,
	HeadlessProviderData,
	HeadlessProviderMapping,
} from 'ai-provider-bridge/headless';
import type { IEngineChatRequest, IModelDescriptor, IModelListing, IProviderMapping } from '../../../positronHeadlessLanguageModel/common/engine.js';
import type { IProviderCatalogChangeData, IResolvedProviderData } from '../../common/aiProviderCatalog.js';

// Compile-time guards that the IPC types stay in step with ai-lib's headless
// entry types. Assignability alone misses a renamed optional field, so each
// pair also pins identical key sets.

type SameKeys<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false;

const _provider = (p: HeadlessProviderData): IResolvedProviderData => p;
const _providerKeys: SameKeys<HeadlessProviderData, IResolvedProviderData> = true;
const _change = (c: HeadlessCatalogChange): IProviderCatalogChangeData => c;
const _changeKeys: SameKeys<HeadlessCatalogChange, IProviderCatalogChangeData> = true;

const _mapping = (m: HeadlessProviderMapping): IProviderMapping => m;
const _mappingKeys: SameKeys<HeadlessProviderMapping, IProviderMapping> = true;
const _model = (m: HeadlessModel): IModelDescriptor => m;
const _modelKeys: SameKeys<HeadlessModel, IModelDescriptor> = true;
const _listing = (l: HeadlessModelListing): IModelListing => l;
const _listingKeys: SameKeys<HeadlessModelListing, IModelListing> = true;
const _request = (r: IEngineChatRequest): HeadlessChatRequest => r;
const _requestKeys: SameKeys<IEngineChatRequest, HeadlessChatRequest> = true;

// @ts-expect-error The entry type is not `any`: an entry without `enabled` is rejected.
const _providerNotAny: HeadlessProviderData = { id: 'anthropic' };
// @ts-expect-error The entry type is not `any`: a mapping without `requiresSession` is rejected.
const _mappingNotAny: HeadlessProviderMapping = { providerId: 'anthropic', scopes: [] };

describe('headless entry shape guard', () => {
	it('keeps the IPC types in step with the entry types (compile-time assertion)', () => {
		const guards = [
			_provider, _providerKeys, _change, _changeKeys,
			_mapping, _mappingKeys, _model, _modelKeys, _listing, _listingKeys, _request, _requestKeys,
			_providerNotAny, _mappingNotAny,
		];
		expect(guards).toHaveLength(14);
	});
});
