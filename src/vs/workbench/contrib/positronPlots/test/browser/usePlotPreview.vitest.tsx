/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, renderHook } from '@testing-library/react';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IOneTimeRender, IRenderedPlot } from '../../../../services/languageRuntime/common/positronPlotRenderQueue.js';
import { usePlotPreview } from '../../browser/modalDialogs/usePlotPreview.js';

class FakeRender implements IOneTimeRender {
	readonly result = new DeferredPromise<IRenderedPlot>();
	readonly startedDeferred = new DeferredPromise<void>();
	// Does not reject: lets tests deliver a result after cancel to prove it is ignored.
	readonly cancel = vi.fn();
	get promise() { return this.result.p; }
	get started() { return this.startedDeferred.p; }
}

const plot = (width: number, height: number) => ({ size: { width, height }, pixel_ratio: 1, uri: `u${width}` }) as IRenderedPlot;

describe('usePlotPreview', () => {
	const closeEmitter = new Emitter<void>();
	let renders: FakeRender[];
	let client: PlotClientInstance;

	beforeEach(() => {
		renders = [];
		client = {
			onDidClose: closeEmitter.event,
			renderOnce: vi.fn(() => {
				const r = new FakeRender();
				renders.push(r);
				return r;
			}),
		} as unknown as PlotClientInstance;
	});

	it('starts waiting then drawing then idle', async () => {
		const { result } = renderHook(() => usePlotPreview(client, 1));
		act(() => result.current.request({ width: 200, height: 100 }));
		expect(result.current.status).toBe('waiting');
		await act(async () => { renders[0].startedDeferred.complete(); });
		expect(result.current.status).toBe('drawing');
		await act(async () => { renders[0].result.complete(plot(200, 100)); });
		expect(result.current.status).toBe('idle');
		expect(result.current.preview?.uri).toBe('u200');
		expect(result.current.pending).toBeUndefined();
	});

	it('cancels the previous draw on a new request', () => {
		const { result } = renderHook(() => usePlotPreview(client, 1));
		act(() => result.current.request({ width: 200, height: 100 }));
		act(() => result.current.request({ width: 300, height: 100 }));
		expect(renders[0].cancel).toHaveBeenCalledOnce();
		expect(result.current.pending?.size).toEqual({ width: 300, height: 100 });
	});

	it('ignores a stale result', async () => {
		const { result } = renderHook(() => usePlotPreview(client, 1));
		act(() => result.current.request({ width: 200, height: 100 }));
		act(() => result.current.request({ width: 300, height: 100 }));
		await act(async () => { renders[0].result.complete(plot(200, 100)); });
		expect(result.current.preview).toBeUndefined();
		expect(result.current.status).toBe('waiting');
		await act(async () => {
			renders[1].startedDeferred.complete();
			renders[1].result.complete(plot(300, 100));
		});
		expect(result.current.preview?.uri).toBe('u300');
		expect(result.current.status).toBe('idle');
	});

	it('cancels a pending draw when the shown size is requested again', async () => {
		const { result } = renderHook(() => usePlotPreview(client, 1));
		act(() => result.current.request({ width: 200, height: 100 }));
		await act(async () => {
			renders[0].startedDeferred.complete();
			renders[0].result.complete(plot(200, 100));
		});
		act(() => result.current.request({ width: 300, height: 100 }));
		act(() => result.current.request({ width: 200, height: 100 }));
		expect(renders).toHaveLength(2);
		expect(renders[1].cancel).toHaveBeenCalledOnce();
		expect(result.current.status).toBe('idle');
		expect(result.current.pending).toBeUndefined();
		await act(async () => { renders[1].result.complete(plot(300, 100)); });
		expect(result.current.preview?.uri).toBe('u200');
	});

	it('does not redraw the same size', async () => {
		const { result } = renderHook(() => usePlotPreview(client, 1));
		act(() => result.current.request({ width: 200, height: 100 }));
		act(() => result.current.request({ width: 200, height: 100 }));
		expect(renders).toHaveLength(1);
		await act(async () => {
			renders[0].startedDeferred.complete();
			renders[0].result.complete(plot(200, 100));
		});
		act(() => result.current.request({ width: 200, height: 100 }));
		expect(renders).toHaveLength(1);
	});

	it('becomes unavailable when the plot closes', async () => {
		const { result } = renderHook(() => usePlotPreview(client, 1));
		act(() => result.current.request({ width: 200, height: 100 }));
		act(() => closeEmitter.fire());
		expect(renders[0].cancel).toHaveBeenCalled();
		expect(result.current.status).toBe('unavailable');
		await act(async () => { renders[0].result.complete(plot(200, 100)); });
		expect(result.current.status).toBe('unavailable');
		expect(result.current.preview).toBeUndefined();
		act(() => result.current.request({ width: 300, height: 100 }));
		expect(renders).toHaveLength(1);
	});

	it('cancels the waiting draw on unmount', () => {
		const { result, unmount } = renderHook(() => usePlotPreview(client, 1));
		act(() => result.current.request({ width: 200, height: 100 }));
		unmount();
		expect(renders[0].cancel).toHaveBeenCalled();
	});

	it('goes back to idle and keeps the preview when a render fails', async () => {
		const { result } = renderHook(() => usePlotPreview(client, 1));
		act(() => result.current.request({ width: 200, height: 100 }));
		await act(async () => {
			renders[0].startedDeferred.complete();
			renders[0].result.complete(plot(200, 100));
		});
		act(() => result.current.request({ width: 300, height: 100 }));
		await act(async () => {
			renders[1].startedDeferred.complete();
			void renders[1].result.error(new Error('boom'));
		});
		expect(result.current.status).toBe('idle');
		expect(result.current.preview?.uri).toBe('u200');
	});
});
