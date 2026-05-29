/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { LRUCache } from '../../../../base/common/map.js';
import { IMermaidRenderService, MermaidTheme } from './mermaidRenderService.js';

const CACHE_LIMIT = 100;

export abstract class MermaidRenderService extends Disposable implements IMermaidRenderService {
	readonly _serviceBrand: undefined;

	private readonly _cache = new LRUCache<string, string>(CACHE_LIMIT);
	private readonly _inflight = new Map<string, Promise<string>>();

	private _cacheKey(source: string, theme: MermaidTheme): string {
		return `${theme}\0${source}`;
	}

	async render(source: string, theme: MermaidTheme): Promise<string> {
		const key = this._cacheKey(source, theme);
		const cached = this._cache.get(key);
		if (cached !== undefined) {
			return cached;
		}

		const existing = this._inflight.get(key);
		if (existing) {
			return existing;
		}

		const promise = this.doRender(source, theme).then(
			svg => { this._cache.set(key, svg); return svg; },
		).finally(() => {
			this._inflight.delete(key);
		});

		this._inflight.set(key, promise);
		return promise;
	}

	protected abstract doRender(source: string, theme: MermaidTheme): Promise<string>;
}
