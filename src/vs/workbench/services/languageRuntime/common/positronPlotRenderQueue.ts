/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../base/common/async.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IPlotSize } from '../../positronPlots/common/sizingPolicy.js';
import { ILanguageRuntimeSession } from '../../runtimeSession/common/runtimeSessionService.js';
import { RuntimeState } from './languageRuntimeService.js';
import { PlotRenderFormat, PositronPlotComm } from './positronPlotComm.js';

/**
 * A rendered plot.
 */
export interface IRenderedPlot {
	/** The size of the plot, in logical pixels, if known */
	size?: IPlotSize;

	/** The pixel ratio of the device for which the plot was rendered */
	pixel_ratio: number;

	/** The plot's image URI. The URI includes the plot itself as a base64-encoded string. */
	uri: string;

	/** The time to render the plot. */
	renderTimeMs: number;
}

/**
 * A request to render a plot.
 */
export interface RenderRequest {
	/**
	 * The size of the plot, in logical pixels. If undefined, the plot will be rendered at its
	 * intrinsic size, if known.
	 */
	size?: IPlotSize;

	/** The pixel ratio of the device for which the plot was rendered */
	pixel_ratio: number;

	/** The format of the plot */
	format: PlotRenderFormat;
}

/**
 * A deferred render request. Used to track the state of a render request that
 * hasn't been fulfilled; mostly a thin wrapper over a `DeferredPromise` that
 * includes the original render request.
 */
export class DeferredRender {
	private readonly deferred: DeferredPromise<IRenderedPlot>;

	constructor(public readonly renderRequest: RenderRequest) {
		this.deferred = new DeferredPromise<IRenderedPlot>();
	}

	/**
	 * Whether the render request has been completed in some way (either by
	 * completing successfully, or by being cancelled or errored).
	 */
	get isComplete(): boolean {
		return this.deferred.isSettled;
	}

	/**
	 * Cancel the render request.
	 */
	cancel(): void {
		this.deferred.cancel();
	}

	/**
	 * Report an error to the render request.
	 */
	error(err: Error): void {
		this.deferred.error(err);
	}

	/**
	 * Complete the render request.
	 */
	complete(plot: IRenderedPlot): void {
		this.deferred.complete(plot);
	}

	get promise(): Promise<IRenderedPlot> {
		return this.deferred.p;
	}
}

export class QueuedRender {
	constructor(
		public readonly render: DeferredRender,
		public readonly comm: PositronPlotComm) {
	}
}

export class PositronPlotRenderQueue {
	private readonly _queue: QueuedRender[] = [];
	private _isRendering = false;

	constructor(private readonly _session: ILanguageRuntimeSession,
		private readonly _logService: ILogService
	) {
		this._logService.debug('PositronPlotRenderQueue: created for session ' + this._session.sessionId);
		this._session.onDidChangeRuntimeState(() => {

			if (this._session.getRuntimeState() === RuntimeState.Idle) {
				if (this._queue.length > 0) {
					this._logService.debug(`[PPRQ - ${this._session.sessionId}] Runtime idle, processing queue.`);
					this.processQueue();
				}
			}
		});
	}

	/**
	 * Queue a render request.
	 *
	 * @param request The render request to queue
	 */
	public queue(request: RenderRequest, comm: PositronPlotComm): DeferredRender {
		const deferredRender = new DeferredRender(request);
		this._queue.push(new QueuedRender(deferredRender, comm));

		this._logService.debug(`[PPRQ - ${this._session.sessionId}] Received request to render plot: ${JSON.stringify(request)} (${comm.clientId}); queue length: ${this._queue.length})`);
		// If the session is idle, start processing the queue.
		if (this._session.getRuntimeState() === RuntimeState.Idle) {
			this.processQueue();
		}
		return deferredRender;
	}

	/**
	 * Process the render queue. If a render is already in progress, this will
	 * do nothing.
	 */
	private processQueue(): void {
		// Nothing to do if the queue is empty.
		if (this._queue.length === 0) {
			this._isRendering = false;
			return;
		}

		// Don't allow re-entrant rendering.
		if (this._isRendering) {
			return;
		}

		this._isRendering = true;
		const queuedRender = this._queue.shift();
		if (!queuedRender) {
			this._isRendering = false;
			return;
		}

		this._logService.debug(`[PPRQ - ${this._session.sessionId}] Processing render request: ${JSON.stringify(queuedRender.render.renderRequest)} (${queuedRender.comm.clientId}); queue length: ${this._queue.length})`);

		// Record the time that the render started so clients can estimate the render time
		const startedTime = Date.now();
		const renderRequest = queuedRender.render.renderRequest;

		queuedRender.comm.render(renderRequest.size,
			renderRequest.pixel_ratio,
			renderRequest.format).then((response) => {
				// The render was successful; record the render time so we can estimate it
				// for future renders.
				const finishedTime = Date.now();
				const renderTimeMs = finishedTime - startedTime;

				// The server returned a rendered plot image; save it and resolve the promise
				const uri = `data:${response.mime_type};base64,${response.data}`;
				const renderResult = {
					...queuedRender.render.renderRequest,
					uri,
					renderTimeMs
				};
				queuedRender.render.complete(renderResult);

				this._logService.debug(`[PPRQ - ${this._session.sessionId}] Completed render request: ${JSON.stringify(queuedRender.render.renderRequest)} (${queuedRender.comm.clientId}); queue length: ${this._queue.length})`);

				// Mark rendering as complete and process the next item in the queue
				this._isRendering = false;
				this.processQueue();
			}).catch((err) => {
				// Handle the error and continue processing the queue
				queuedRender.render.error(err);
				this._isRendering = false;
				this.processQueue();
			});
	}
}

