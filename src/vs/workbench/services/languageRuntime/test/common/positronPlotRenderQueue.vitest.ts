/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { Emitter } from '../../../../../base/common/event.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeSession } from '../../../runtimeSession/common/runtimeSessionService.js';
import { RuntimeState } from '../../common/languageRuntimeService.js';
import { PlotRenderFormat, PlotResult, PlotSize, PositronPlotComm } from '../../common/positronPlotComm.js';
import { DeferredRender, OperationType, PositronPlotRenderQueue, RenderRequest } from '../../common/positronPlotRenderQueue.js';

describe('Positron - PositronPlotRenderQueue', () => {
	const disposables = ensureNoLeakedDisposables();

	let runtimeState: RuntimeState;
	let stateEmitter: Emitter<RuntimeState>;
	let closeEmitter: Emitter<void>;
	let renderResults: DeferredPromise<PlotResult>[];
	let commRender: ReturnType<typeof vi.fn<(size: PlotSize | undefined, pixelRatio: number, format: PlotRenderFormat) => Promise<PlotResult>>>;
	let comm: PositronPlotComm;
	let queue: PositronPlotRenderQueue;

	const result: PlotResult = { mime_type: 'image/png', data: 'AA' };

	function request(width: number): RenderRequest {
		return { size: { width, height: 100 }, pixel_ratio: 1, format: PlotRenderFormat.Png };
	}

	function setState(state: RuntimeState): void {
		runtimeState = state;
		stateEmitter.fire(state);
	}

	/** Resolve every comm render issued so far, letting the queue move on to the next one. */
	async function drain(): Promise<void> {
		for (let i = 0; i < 10; i++) {
			renderResults.forEach(r => r.complete(result));
			await timeout(0);
		}
	}

	beforeEach(() => {
		runtimeState = RuntimeState.Idle;
		stateEmitter = disposables.add(new Emitter<RuntimeState>());
		closeEmitter = disposables.add(new Emitter<void>());
		renderResults = [];
		commRender = vi.fn(() => {
			const deferred = new DeferredPromise<PlotResult>();
			renderResults.push(deferred);
			return deferred.p;
		});
		comm = stubInterface<PositronPlotComm>({
			clientId: 'plot-1',
			onDidClose: closeEmitter.event,
			render: commRender,
		});
		const session = stubInterface<ILanguageRuntimeSession>({
			sessionId: 'session-1',
			getRuntimeState: () => runtimeState,
			onDidChangeRuntimeState: stateEmitter.event,
		});
		queue = disposables.add(new PositronPlotRenderQueue(session, new NullLogService()));
	});

	it('cancelQueuedOperation removes only the given operation', async () => {
		runtimeState = RuntimeState.Busy;
		const first = queue.queueOneTimeRender(request(200), comm);
		const second = queue.queueOneTimeRender(request(300), comm);
		const paneRender = queue.queue(new DeferredRender(request(400)), comm);

		first.cancel();
		await expect(first.promise).rejects.toSatisfy(isCancellationError);

		setState(RuntimeState.Idle);
		await drain();

		expect(commRender.mock.calls.map(call => call[0])).toEqual([
			{ width: 300, height: 100 },
			{ width: 400, height: 100 },
		]);
		await expect(second.promise).resolves.toBeDefined();
		await expect(paneRender.promise).resolves.toBeDefined();
	});

	it('cancelQueuedOperation returns false once the operation started', () => {
		const operation = queue.queueOperation({ type: OperationType.Render, ...request(200) }, comm);

		expect(queue.cancelQueuedOperation(operation)).toBe(false);
		expect(commRender).toHaveBeenCalledTimes(1);
	});

	it('started resolves only when processing begins', async () => {
		runtimeState = RuntimeState.Busy;
		const render = queue.queueOneTimeRender(request(200), comm);
		let started = false;
		render.started.then(() => started = true);

		await timeout(0);
		expect(started).toBe(false);

		setState(RuntimeState.Idle);
		await timeout(0);
		expect(started).toBe(true);
		await drain();
	});

	it('queue() renders do not cancel one-time renders', async () => {
		runtimeState = RuntimeState.Busy;
		const oneTime = queue.queueOneTimeRender(request(200), comm);
		const paneRender = queue.queue(new DeferredRender(request(400)), comm);

		setState(RuntimeState.Idle);
		await drain();

		expect((await oneTime.promise).uri).toMatch(/^data:image\/png;base64,/);
		expect((await paneRender.promise).uri).toMatch(/^data:image\/png;base64,/);
	});

	it('cancel settles the promise even after start', async () => {
		const render = queue.queueOneTimeRender(request(200), comm);
		expect(commRender).toHaveBeenCalledTimes(1);

		render.cancel();
		await expect(render.promise).rejects.toSatisfy(isCancellationError);

		await drain();
	});

	it('cancels a queued one-time render when its comm closes', async () => {
		runtimeState = RuntimeState.Busy;
		const render = queue.queueOneTimeRender(request(200), comm);

		closeEmitter.fire();

		await expect(render.promise).rejects.toSatisfy(isCancellationError);
		setState(RuntimeState.Idle);
		expect(commRender).not.toHaveBeenCalled();
	});
});
