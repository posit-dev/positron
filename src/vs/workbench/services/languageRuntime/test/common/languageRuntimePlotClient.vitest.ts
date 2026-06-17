/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { timeout } from '../../../../../base/common/async.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IPositronPlotMetadata, PlotClientInstance } from '../../common/languageRuntimePlotClient.js';
import { PositronPlotCommProxy } from '../../common/positronPlotCommProxy.js';
import { IPositronPlotSizingPolicy } from '../../../positronPlots/common/sizingPolicy.js';
import { PlotRenderFormat, PlotResult, PlotSize, ShowEvent, UpdateEvent, IntrinsicSize } from '../../common/positronPlotComm.js';
import { DeferredRender, IRenderedPlot } from '../../common/positronPlotRenderQueue.js';

describe('Positron - PlotClientInstance', () => {
	const disposables = ensureNoLeakedDisposables();

	let renderUpdateEmitter: Emitter<UpdateEvent>;
	let showPlotEmitter: Emitter<ShowEvent>;
	let closeEmitter: Emitter<void>;
	let renderSpy: ReturnType<typeof vi.fn<(request: DeferredRender) => void>>;

	/** Build a pre-render whose data (and therefore URI) and settings are controllable. */
	function preRender(data: string, size: PlotSize = { width: 100, height: 100 }): PlotResult {
		return {
			data,
			mime_type: 'image/png',
			settings: { size, pixel_ratio: 1, format: PlotRenderFormat.Png },
		};
	}

	function createPlotClient(metadata: Partial<IPositronPlotMetadata>): PlotClientInstance {
		const intrinsicSizeEmitter = disposables.add(new Emitter<IntrinsicSize | undefined>());
		const commProxy = stubInterface<PositronPlotCommProxy>({
			onDidClose: closeEmitter.event,
			onDidRenderUpdate: renderUpdateEmitter.event,
			onDidShowPlot: showPlotEmitter.event,
			onDidSetIntrinsicSize: intrinsicSizeEmitter.event,
			render: renderSpy,
		});
		const fullMetadata: IPositronPlotMetadata = {
			id: 'plot-1', created: 0, code: '', session_id: 'session-1', ...metadata,
		};
		return disposables.add(new PlotClientInstance(
			commProxy,
			new TestConfigurationService(),
			stubInterface<IPositronPlotSizingPolicy>(),
			fullMetadata,
		));
	}

	beforeEach(() => {
		renderUpdateEmitter = disposables.add(new Emitter<UpdateEvent>());
		showPlotEmitter = disposables.add(new Emitter<ShowEvent>());
		closeEmitter = disposables.add(new Emitter<void>());
		renderSpy = vi.fn<(request: DeferredRender) => void>();
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
});
