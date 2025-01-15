/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { IRuntimeClientInstance, RuntimeClientState } from './languageRuntimeClientInstance.js';
import { IntrinsicSize, PositronPlotComm, RenderFormat } from './positronPlotComm.js';
import { IPlotSize } from '../../positronPlots/common/sizingPolicy.js';

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
	format: RenderFormat;
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

export class PositronPlotCommProxy extends Disposable {
	/**
	 * The currently active render request, if any.
	 */
	private _currentRender?: DeferredRender;

	/**
	 * The underlying comm
	 */
	private _comm: PositronPlotComm;

	/**
	 * The render queue. If a render is in progress, new renders are queued
	 */
	private _renderQueue = new Array<DeferredRender>();

	/**
	 * The intrinsic size of the plot, if known.
	 */
	private _intrinsicSize?: IntrinsicSize;

	/**
	 * Whether the plot has received its intrinsic size (even if it's unknown) from the runtime.
	 */
	private _receivedIntrinsicSize = false;

	/**
	 * The response of the currently active intrinsic size request, if any.
	 */
	private _currentIntrinsicSize?: Promise<IntrinsicSize | undefined>;

	/**
	 * Event that fires when the plot is closed on the runtime side, typically
	 * because the runtime exited and doesn't preserve plot state.
	 */
	onDidClose: Event<void>;
	private readonly _closeEmitter = new Emitter<void>();

	/**
	 * Event that fires when the plot has been updated by the runtime and
	 * re-rendered. Notifies clients so they can request a render update with their own
	 * render parameters.
	 */
	onDidRenderUpdate: Event<void>;
	private readonly _renderUpdateEmitter = new Emitter<void>();

	/**
	 * Event that fires when the plot wants to display itself.
	*/
	onDidShowPlot: Event<void>;
	private readonly _didShowPlotEmitter = new Emitter<void>();

	/**
	 * Event that fires when the intrinsic size of the plot is set.
	 */
	onDidSetIntrinsicSize: Event<IntrinsicSize | undefined>;
	private readonly _didSetIntrinsicSizeEmitter = new Emitter<IntrinsicSize | undefined>();

	constructor(
		client: IRuntimeClientInstance<any, any>) {
		super();

		this._comm = new PositronPlotComm(client, { render: { timeout: 30000 }, get_intrinsic_size: { timeout: 30000 } });

		const clientStateEvent = Event.fromObservable(client.clientState);

		// Connect close emitter event
		this.onDidClose = this._closeEmitter.event;
		this._register(clientStateEvent((state) => {
			if (state === RuntimeClientState.Closed) {
				this._closeEmitter.fire();

				// Silently cancel any pending render requests
				this._currentRender?.cancel();
				this._renderQueue.forEach((render) => render.cancel());
			}
		}));

		// Connect the render update emitter event
		this.onDidRenderUpdate = this._renderUpdateEmitter.event;

		// Connect the show plot emitter event
		this.onDidShowPlot = this._didShowPlotEmitter.event;

		// Connect the intrinsic size emitter event
		this.onDidSetIntrinsicSize = this._didSetIntrinsicSizeEmitter.event;

		this._register(this._comm.onDidClose(() => {
			this._closeEmitter.fire();
		}));

		this._register(this._comm.onDidShow(() => {
			this._didShowPlotEmitter.fire();
		}));

		this._register(this._comm.onDidUpdate((_evt) => {
			this._renderUpdateEmitter.fire();
		}));

		this._register(this._comm);
	}

	/**
	 * Returns the intrinsic size of the plot, if known.
	 */
	get intrinsicSize(): IntrinsicSize | undefined {
		return this._intrinsicSize;
	}

	/**
	 * Returns a boolean indicating whether this plot has a known intrinsic size.
	 */
	get receivedIntrinsicSize(): boolean {
		return this._receivedIntrinsicSize;
	}

	/**
	 * Get the intrinsic size of the plot, if known.
	 *
	 * @returns A promise that resolves to the intrinsic size of the plot, if known.
	 */
	public getIntrinsicSize(): Promise<IntrinsicSize | undefined> {
		// If there's already an in-flight request, return its response.
		if (this._currentIntrinsicSize) {
			return this._currentIntrinsicSize;
		}
		this._currentIntrinsicSize = this._comm.getIntrinsicSize()
			.then((intrinsicSize) => {
				this._intrinsicSize = intrinsicSize;
				this._receivedIntrinsicSize = true;
				this._didSetIntrinsicSizeEmitter.fire(intrinsicSize);
				return intrinsicSize;
			})
			.finally(() => {
				this._currentIntrinsicSize = undefined;
			});
		return this._currentIntrinsicSize;
	}

	/**
	 * Renders a plot. The request is queued if a render is already in progress.
	 *
	 * @param request The render request to perform
	 */
	public render(request: DeferredRender): void {
		// Record the time that the render started so clients can estimate the render time
		const startedTime = Date.now();

		// Perform the RPC request and resolve the promise when the response is received
		const renderRequest = request.renderRequest;
		this._comm.render(renderRequest.size,
			renderRequest.pixel_ratio,
			renderRequest.format).then((response) => {

				// Ignore if the request was cancelled or already fulfilled
				if (!request.isComplete) {
					// The render was successful; record the render time so we can estimate it
					// for future renders.
					const finishedTime = Date.now();
					const renderTimeMs = finishedTime - startedTime;

					// The server returned a rendered plot image; save it and resolve the promise
					const uri = `data:${response.mime_type};base64,${response.data}`;
					const renderResult = {
						...request.renderRequest,
						uri,
						renderTimeMs
					};
					request.complete(renderResult);
				}

				// If there is a queued render request, promote it to the current
				// request and perform it now.
				if (this._renderQueue.length > 0) {
					const queuedRender = this._renderQueue.shift();
					if (queuedRender) {
						this._currentRender = queuedRender;
						this.render(queuedRender);
					}
				}
			}).catch((err) => {
				request.error(err);
			});
	}
}
