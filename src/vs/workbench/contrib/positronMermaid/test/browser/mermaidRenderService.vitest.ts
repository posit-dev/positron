/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DeferredPromise } from '../../../../../base/common/async.js';
import { MermaidRenderService } from '../../browser/mermaidRenderServiceImpl.js';
import { MermaidTheme } from '../../browser/mermaidRenderService.js';

/**
 * Test subclass that replaces the webview backend with a controllable mock.
 */
class TestMermaidRenderService extends MermaidRenderService {
	readonly renderCalls: Array<{ source: string; theme: MermaidTheme }> = [];
	renderResult: string | Error | DeferredPromise<string> = '<svg>mock</svg>';

	protected override doRender(source: string, theme: MermaidTheme): Promise<string> {
		this.renderCalls.push({ source, theme });
		if (this.renderResult instanceof DeferredPromise) {
			return this.renderResult.p;
		}
		if (this.renderResult instanceof Error) {
			return Promise.reject(this.renderResult);
		}
		return Promise.resolve(this.renderResult);
	}
}

describe('MermaidRenderService', () => {
	let service: TestMermaidRenderService;

	beforeEach(() => {
		service = new TestMermaidRenderService();
	});

	afterEach(() => {
		service.dispose();
	});

	it('returns SVG from a render call', async () => {
		service.renderResult = '<svg>diagram</svg>';
		const result = await service.render('graph TD; A-->B', 'default');
		expect(result).toBe('<svg>diagram</svg>');
	});

	it('returns cached result on second call with same source and theme', async () => {
		service.renderResult = '<svg>cached</svg>';
		await service.render('graph TD; A-->B', 'default');
		service.renderResult = '<svg>should not be used</svg>';
		const result = await service.render('graph TD; A-->B', 'default');
		expect(result).toBe('<svg>cached</svg>');
		expect(service.renderCalls).toHaveLength(1);
	});

	it('caches separately by theme', async () => {
		service.renderResult = '<svg>light</svg>';
		await service.render('graph TD; A-->B', 'default');
		service.renderResult = '<svg>dark</svg>';
		await service.render('graph TD; A-->B', 'dark');
		expect(service.renderCalls).toHaveLength(2);
		expect(await service.render('graph TD; A-->B', 'default')).toBe('<svg>light</svg>');
		expect(await service.render('graph TD; A-->B', 'dark')).toBe('<svg>dark</svg>');
	});

	it('does not cache errors', async () => {
		service.renderResult = new Error('parse error');
		await expect(service.render('bad syntax', 'default')).rejects.toThrow('parse error');
		service.renderResult = '<svg>fixed</svg>';
		const result = await service.render('bad syntax', 'default');
		expect(result).toBe('<svg>fixed</svg>');
		expect(service.renderCalls).toHaveLength(2);
	});

	it('evicts oldest entries when cache exceeds limit', async () => {
		const limit = 100;
		for (let i = 0; i <= limit; i++) {
			service.renderResult = `<svg>${i}</svg>`;
			await service.render(`graph ${i}`, 'default');
		}
		// Entry 0 should have been evicted
		service.renderResult = '<svg>re-rendered</svg>';
		const result = await service.render('graph 0', 'default');
		expect(result).toBe('<svg>re-rendered</svg>');
		// Entry at the limit should still be cached
		service.renderResult = '<svg>should not be used</svg>';
		const cachedResult = await service.render(`graph ${limit}`, 'default');
		expect(cachedResult).toBe(`<svg>${limit}</svg>`);
	});

	it('deduplicates concurrent requests for the same source and theme', async () => {
		const deferred = new DeferredPromise<string>();
		service.renderResult = deferred;
		const p1 = service.render('graph TD; A-->B', 'default');
		const p2 = service.render('graph TD; A-->B', 'default');
		deferred.complete('<svg>deduped</svg>');
		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1).toBe('<svg>deduped</svg>');
		expect(r2).toBe('<svg>deduped</svg>');
		expect(service.renderCalls).toHaveLength(1);
	});

	it('does not cache inflight results after rejection', async () => {
		const deferred = new DeferredPromise<string>();
		service.renderResult = deferred;
		const promise = service.render('graph TD; A-->B', 'default');
		deferred.error(new Error('Service disposed'));
		await expect(promise).rejects.toThrow('Service disposed');
		// After rejection, a retry should call doRender again (not return cached error)
		service.renderResult = '<svg>recovered</svg>';
		const result = await service.render('graph TD; A-->B', 'default');
		expect(result).toBe('<svg>recovered</svg>');
		expect(service.renderCalls).toHaveLength(2);
	});
});
