/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { timeout } from '../../../../../base/common/async.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IPositronPlotMetadata, PlotClientInstance } from '../../common/languageRuntimePlotClient.js';
import { PositronPlotCommProxy } from '../../common/positronPlotCommProxy.js';
import { IPositronPlotSizingPolicy } from '../../../positronPlots/common/sizingPolicy.js';
import { PlotSizingPolicyAuto } from '../../../positronPlots/common/sizingPolicyAuto.js';
import { PlotSizingPolicyFill } from '../../../positronPlots/common/sizingPolicyFill.js';
import { PlotSizingPolicyIntrinsic } from '../../../positronPlots/common/sizingPolicyIntrinsic.js';
import { PlotRenderFormat, PlotResult, PlotSize, ShowEvent, UpdateEvent, IntrinsicSize } from '../../common/positronPlotComm.js';
import { DeferredRender, IRenderedPlot } from '../../common/positronPlotRenderQueue.js';

describe('Positron - PlotClientInstance', () => {
	const disposables = ensureNoLeakedDisposables();

	let renderUpdateEmitter: Emitter<UpdateEvent>;
	let showPlotEmitter: Emitter<ShowEvent>;
	let closeEmitter: Emitter<void>;
	let renderSpy: ReturnType<typeof vi.fn<(request: DeferredRender) => void>>;
	let getIntrinsicSize: ReturnType<typeof vi.fn<() => Promise<IntrinsicSize | undefined>>>;

	/** Build a pre-render whose data (and therefore URI) and settings are controllable. */
	function preRender(data: string, size: PlotSize = { width: 100, height: 100 }): PlotResult {
		return {
			data,
			mime_type: 'image/png',
			settings: { size, pixel_ratio: 1, format: PlotRenderFormat.Png },
		};
	}

	function createPlotClient(
		metadata: Partial<IPositronPlotMetadata>,
		sizingPolicy = stubInterface<IPositronPlotSizingPolicy>(),
	): PlotClientInstance {
		const intrinsicSizeEmitter = disposables.add(new Emitter<IntrinsicSize | undefined>());
		const commProxy = stubInterface<PositronPlotCommProxy>({
			onDidClose: closeEmitter.event,
			onDidRenderUpdate: renderUpdateEmitter.event,
			onDidShowPlot: showPlotEmitter.event,
			onDidSetIntrinsicSize: intrinsicSizeEmitter.event,
			eventParentId: undefined,
			render: renderSpy,
			getIntrinsicSize,
		});
		const fullMetadata: IPositronPlotMetadata = {
			id: 'plot-1', created: 0, code: '', session_id: 'session-1', ...metadata,
		};
		return disposables.add(new PlotClientInstance(
			commProxy,
			new TestConfigurationService(),
			sizingPolicy,
			fullMetadata,
		));
	}

	beforeEach(() => {
		renderUpdateEmitter = disposables.add(new Emitter<UpdateEvent>());
		showPlotEmitter = disposables.add(new Emitter<ShowEvent>());
		closeEmitter = disposables.add(new Emitter<void>());
		renderSpy = vi.fn<(request: DeferredRender) => void>();
		getIntrinsicSize = vi.fn(() => Promise.resolve(undefined));
	});

	it('onDidShowPlot only fires a complete render when the pre-render URI changed', () => {
		// comm_open already placed this pre-render in _lastRender (via the constructor).
		const client = createPlotClient({ pre_render: preRender('AAAA') });
		const completed: IRenderedPlot[] = [];
		disposables.add(client.onDidCompleteRender(plot => completed.push(plot)));

		// A show event carrying the same pre-render (matching URI) must not re-fire.
		showPlotEmitter.fire({ pre_render: preRender('AAAA') });
		expect(completed).toEqual([]);

		// A show event carrying new content (different URI) must fire once.
		showPlotEmitter.fire({ pre_render: preRender('BBBB') });
		expect(completed.map(p => p.uri)).toEqual(['data:image/png;base64,BBBB']);
	});

	it('onDidRenderUpdate queues a full re-render when pre-render settings differ', async () => {
		// _lastRender is the pre-render at 100x100; no render is in flight.
		createPlotClient({ pre_render: preRender('AAAA', { width: 100, height: 100 }) });

		// An update with different settings (200x200) must fall through to a full
		// re-render rather than short-circuiting on a self-comparison.
		renderUpdateEmitter.fire({ pre_render: preRender('BBBB', { width: 200, height: 200 }) });

		// scheduleRender debounces via a 0ms timer before calling the comm.
		await timeout(0);

		expect(renderSpy).toHaveBeenCalledTimes(1);
		const queued = renderSpy.mock.calls[0][0] as DeferredRender;
		expect(queued.renderRequest.size).toEqual({ width: 200, height: 200 });
	});

	it('reports a failed update that replaced a render still in flight', async () => {
		const client = createPlotClient({ pre_render: preRender('AAAA') });
		const failures: string[] = [];
		disposables.add(client.onDidFailRenderUpdate(err => failures.push(err.message)));

		// The pane asks for a size, then R redraws the plot before that render returns.
		const paneRender = client.render({ width: 300, height: 50 }, 1);
		await vi.waitFor(() => expect(renderSpy).toHaveBeenCalledTimes(1));
		renderUpdateEmitter.fire({});
		await vi.waitFor(() => expect(renderSpy).toHaveBeenCalledTimes(2));

		// The update replaces the pane's render, so the pane hears about it only through the event.
		await expect(paneRender).rejects.toThrow('Canceled');
		renderSpy.mock.calls[1][0].error(new Error('figure margins too large'));

		await vi.waitFor(() => expect(failures).toEqual(['figure margins too large']));
	});

	it('draws again at the last size after an update from R fails, until a draw succeeds', async () => {
		const client = createPlotClient({ pre_render: preRender('AAAA') });
		// The pane reads the flag in its listener, so it must be set before the event fires.
		const staleWhenFailed: boolean[] = [];
		disposables.add(client.onDidFailRenderUpdate(() => staleWhenFailed.push(client.lastRenderStale)));

		// R redraws the plot and that render fails, so the saved image is out of date.
		renderUpdateEmitter.fire({});
		await vi.waitFor(() => expect(renderSpy).toHaveBeenCalledTimes(1));
		renderSpy.mock.calls[0][0].error(new Error('figure margins too large'));
		await vi.waitFor(() => expect(staleWhenFailed).toEqual([true]));

		// Asking for the saved image's size must ask R again, not reuse the old image.
		const redraw = client.render({ width: 100, height: 100 }, 1);
		await vi.waitFor(() => expect(renderSpy).toHaveBeenCalledTimes(2));
		const current: IRenderedPlot = {
			uri: 'data:image/png;base64,CCCC', size: { width: 100, height: 100 },
			pixel_ratio: 1, format: PlotRenderFormat.Png, renderTimeMs: 0,
		};
		renderSpy.mock.calls[1][0].complete(current);
		await redraw;

		// Once a draw succeeds, the same size is served from the saved image again.
		expect(client.lastRenderStale).toBe(false);
		await expect(client.render({ width: 100, height: 100 }, 1)).resolves.toBe(current);
		expect(renderSpy).toHaveBeenCalledTimes(2);
	});

	it('marks R\'s first image until a view gets a render at its own size', async () => {
		const client = createPlotClient({ pre_render: preRender('AAAA', { width: 100, height: 100 }) });
		expect(client.lastRenderIsPreRender).toBe(true);

		// A failed render at another size leaves only R's first image.
		const small = client.render({ width: 100, height: 20 }, 1);
		await vi.waitFor(() => expect(renderSpy).toHaveBeenCalledTimes(1));
		renderSpy.mock.calls[0][0].error(new Error('figure margins too large'));
		await expect(small).rejects.toThrow('figure margins too large');
		expect(client.lastRenderIsPreRender).toBe(true);

		// The first image at the asked size is the view's own render.
		await client.render({ width: 100, height: 100 }, 1);
		expect(client.lastRenderIsPreRender).toBe(false);
	});

	it('clears the mark when a render at a new size succeeds', async () => {
		const client = createPlotClient({ pre_render: preRender('AAAA', { width: 100, height: 100 }) });

		const render = client.render({ width: 200, height: 200 }, 1);
		await vi.waitFor(() => expect(renderSpy).toHaveBeenCalledTimes(1));
		renderSpy.mock.calls[0][0].complete({
			uri: 'data:image/png;base64,BBBB', size: { width: 200, height: 200 },
			pixel_ratio: 1, format: PlotRenderFormat.Png, renderTimeMs: 0,
		});
		await render;

		expect(client.lastRenderIsPreRender).toBe(false);
	});

	it('draws a plot on Intrinsic with no intrinsic size at the Auto size', async () => {
		const client = createPlotClient({}, new PlotSizingPolicyIntrinsic());

		client.renderWithSizingPolicy({ width: 800, height: 200 }, 1);

		await vi.waitFor(() => expect(renderSpy).toHaveBeenCalledTimes(1));
		expect(renderSpy.mock.calls[0][0].renderRequest.size)
			.toEqual(new PlotSizingPolicyAuto().getPlotSize({ width: 800, height: 200 }));
	});

	it('asks for the intrinsic size on a render at another size, so the sizing menu can offer Intrinsic', async () => {
		const client = createPlotClient({}, new PlotSizingPolicyFill());

		client.renderWithSizingPolicy({ width: 800, height: 200 }, 1);

		await vi.waitFor(() => expect(renderSpy).toHaveBeenCalledTimes(1));
		expect(getIntrinsicSize).toHaveBeenCalled();
	});
});
