/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IRuntimeClientInstance, RuntimeClientState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { Event, Emitter } from 'vs/base/common/event';
import { DeferredPromise } from 'vs/base/common/async';

/**
 * The possible states for the plot client instance
 */
export enum PlotClientState {
	/** The plot client has never rendered a plot */
	Unrendered = 'unrendered',

	/** The plot client has been requested to render a plot, but hasn't done it yet. */
	RenderPending = 'render_pending',

	/** The plot client is currently rendering a plot */
	Rendering = 'rendering',

	/** The plot client has rendered a plot */
	Rendered = 'rendered',

	/** The plot client is closed (disconnected); it cannot render any further plots */
	Closed = 'closed',
}

/**
 * The possible types of messages that can be sent to the language runtime as
 * requests to the plot backend.
 */
export enum PlotClientMessageTypeInput {
	/** A request to render the plot at a specific size */
	Render = 'render',
}

/**
 * The possible types of messages that can be sent from the plot backend.
 */
export enum PlotClientMessageTypeOutput {
	/** Rendered plot output */
	Image = 'image',

	/** Notification that a plot has changed on the backend */
	Update = 'update',

	/** A processing error */
	Error = 'error',
}

/**
 * A message used to send data to the language runtime plot client.
 */
export interface IPlotClientMessageInput {
	msg_type: PlotClientMessageTypeInput;
}

/**
 * A message used to request that a plot render at a specific size.
 */
export interface IPlotClientMessageRender extends IPlotClientMessageInput {
	/** The plot height, in pixels */
	height: number;

	/** The plot width, in pixels */
	width: number;

	/**
	 * The pixel ratio of the display device; typically 1 for standard displays,
	 * 2 for retina/high DPI displays, etc.
	 */
	pixel_ratio: number;
}

/**
 * A message used to receive data from the language runtime plot client.
 */
export interface IPlotClientMessageOutput {
	msg_type: PlotClientMessageTypeOutput;
}

/**
 * A message used to receive rendered plot output.
 */
export interface IPlotClientMessageImage extends IPlotClientMessageOutput {
	/**
	 * The data for the plot image, as a base64-encoded string. We need to send
	 * the plot data as a string because the underlying image file exists only
	 * on the machine running the language runtime process.
	 */
	data: string;

	/**
	 * The MIME type of the image data, e.g. `image/png`. This is used to
	 * determine how to display the image in the UI.
	 */
	mime_type: string;
}

/**
 * A message used to deliver a plot rendering error.
 */
export interface IPlotClientMessageError extends IPlotClientMessageOutput {
	message: string;
}

/**
 * A rendered plot.
 */
export interface IRenderedPlot {
	/** The height of the plot, in logical pixels */
	height: number;

	/** The width of the plot, in logical pixels */
	width: number;

	/** The pixel ratio of the device for which the plot was rendered */
	pixel_ratio: number;

	/** The plot's image URI. The URI includes the plot itself as a base64-encoded string. */
	uri: string;
}

/** The metadata associated with a Positron plot */
export interface IPositronPlotMetadata {
	/** The plot's unique ID, as supplied by the language runtime */
	id: string;

	/** The plot's moment of creation, in milliseconds since the Epoch */
	created: number;

	/** The code that created the plot, if known. */
	code: string;

	/** The plot's parent message ID; useful for jumping to associated spot in the console */
	parent_id: string;

	/** The ID of the runtime that created the plot */
	runtime_id: string;
}

/**
 * A deferred render request. Used to track the state of a render request that
 * hasn't been fulfilled; mostly a thin wrapper over a `DeferredPromise` that
 * includes the original render request.
 */
class DeferredRender {
	private readonly deferred: DeferredPromise<IRenderedPlot>;

	constructor(public readonly renderRequest: IPlotClientMessageRender) {
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

/**
 * An instance of a plot client widget generated by a language runtime. A plot can be rendered
 * by calling the `render` method, which returns a promise that resolves to the rendered plot.
 */
export class PlotClientInstance extends Disposable {
	/**
	 * The currently active render request, if any.
	 */
	private _currentRender?: DeferredRender;

	/**
	 * The queued render request, if any.
	 */
	private _queuedRender?: DeferredRender;

	/**
	 * The last rendered plot, if any.
	 */
	private _lastRender?: IRenderedPlot;

	/**
	 * The timer used to throttle plot rendering requests.
	 */
	private _renderThrottleTimer?: NodeJS.Timeout;

	/**
	 * The current state of the plot client.
	 */
	private _state: PlotClientState = PlotClientState.Unrendered;

	/**
	 * The time it took to render the plot the last time it was rendered, in milliseconds.
	 */
	private _lastRenderTimeMs: number = 0;

	/**
	 * Event that fires when the plot is closed on the runtime side, typically
	 * because the runtime exited and doesn't preserve plot state.
	 */
	onDidClose: Event<void>;
	private readonly _closeEmitter = new Emitter<void>();

	/**
	 * Event that fires when the state of the plot client changes.
	 */
	onDidChangeState: Event<PlotClientState>;
	private readonly _stateEmitter = new Emitter<PlotClientState>();

	/**
	 * Event that fires when the plot has finished rendering.
	 */
	onDidCompleteRender: Event<IRenderedPlot>;
	private readonly _completeRenderEmitter = new Emitter<IRenderedPlot>();

	/**
	 * Creates a new plot client instance.
	 *
	 * @param _client The client instance for this plot
	 * @param metadata The plot's metadata
	 */
	constructor(
		private readonly _client: IRuntimeClientInstance<IPlotClientMessageInput, IPlotClientMessageOutput>,
		public readonly metadata: IPositronPlotMetadata) {
		super();

		// Connect close emitter event
		this.onDidClose = this._closeEmitter.event;
		_client.onDidChangeClientState((state) => {
			if (state === RuntimeClientState.Closed) {
				this._closeEmitter.fire();
			}
			this._stateEmitter.fire(PlotClientState.Closed);
		});

		// Connect the state emitter event
		this.onDidChangeState = this._stateEmitter.event;

		// Connect the complete render emitter event
		this.onDidCompleteRender = this._completeRenderEmitter.event;

		// Listen to our own state changes
		this.onDidChangeState((state) => {
			this._state = state;
		});

		// Listen for plot updates
		_client.onDidReceiveData((data) => {
			if (data.msg_type === PlotClientMessageTypeOutput.Update) {
				// When the server notifies us that a plot update has occurred,
				// queue a request for the UI to update the plot.
				this.queuePlotUpdateRequest();
			}
		});

		// Register the client instance with the runtime, so that when this instance is disposed,
		// the runtime will also dispose the client.
		this._register(_client);
	}

	/**
	 * Requests that the plot be rendered at a specific size.
	 *
	 * @param height The plot height, in pixels
	 * @param width The plot width, in pixels
	 * @param pixel_ratio The device pixel ratio (e.g. 1 for standard displays, 2 for retina displays)
	 * @returns A promise that resolves to a rendered image, or rejects with an error.
	 */
	public render(height: number, width: number, pixel_ratio: number): Promise<IRenderedPlot> {
		// Compare against the last render request. It is normal for the same
		// render request to be made multiple times, e.g. when the UI component
		// is redrawn without changing the plot size.
		if (this._lastRender &&
			this._lastRender.height === height &&
			this._lastRender.width === width &&
			this._lastRender.pixel_ratio === pixel_ratio) {
			// The last render request was the same size; return the last render
			// result without performing another render.
			return Promise.resolve(this._lastRender);
		}

		// Create a new deferred promise to track the render request
		const request: IPlotClientMessageRender = {
			msg_type: PlotClientMessageTypeInput.Render,
			height,
			width,
			pixel_ratio
		};
		const deferred = new DeferredRender(request);

		// Check which render request is currently pending. If we are currently
		// rendering, then it's the queued render request. Otherwise, it's the
		// current render request.
		const pending = this._state === PlotClientState.Rendering ?
			this._queuedRender : this._currentRender;

		// If there is already a render request in flight, cancel it; this
		// request supercedes it.
		if (pending && !pending.isComplete) {
			pending.cancel();
		}

		if (this._state === PlotClientState.Rendering) {
			// We are currently rendering; don't start another render until we're done.
			this._queuedRender = deferred;
		} else {
			// We are not currently rendering; start a new render. Render
			// immediately if we have never rendered before; otherwise, throttle
			// (debounce) the render.
			this._currentRender = deferred;
			this.scheduleRender(deferred, this._state === PlotClientState.Unrendered ? 0 : 500);
		}

		return deferred.promise;
	}

	/**
	 * Schedules the render request to be performed after a short delay.
	 *
	 * @param request The render request to schedule
	 * @param delay The delay, in milliseconds
	 */
	private scheduleRender(request: DeferredRender, delay: number) {

		// If there is a render throttle timer, clear it
		if (this._renderThrottleTimer) {
			clearTimeout(this._renderThrottleTimer);
		}

		// If this is the first render request, perform it immediately. Otherwise,
		// throttle the request.
		this._stateEmitter.fire(PlotClientState.RenderPending);
		this._renderThrottleTimer = setTimeout(() => {
			this.performDebouncedRender(request);
		}, delay);
	}

	/**
	 * Actually performs the render
	 *
	 * @param request The render request to perform
	 */
	private performDebouncedRender(request: DeferredRender) {
		this._stateEmitter.fire(PlotClientState.Rendering);

		// Record the time that the render started so we can estimate the render time
		const startedTime = Date.now();

		// Perform the RPC request and resolve the promise when the response is received
		this._client.performRpc(request.renderRequest).then((response) => {

			// Ignore if the request was cancelled or already fulfilled
			if (!request.isComplete) {
				if (response.msg_type === PlotClientMessageTypeOutput.Image) {

					// The render was successful; record the render time so we can estimate it
					// for future renders.
					const finishedTime = Date.now();
					this._lastRenderTimeMs = finishedTime - startedTime;

					// The server returned a rendered plot image; save it and resolve the promise
					const image = response as IPlotClientMessageImage;
					const uri = `data:${image.mime_type};base64,${image.data}`;
					this._lastRender = {
						...request.renderRequest,
						uri
					};
					request.complete(this._lastRender);
					this._stateEmitter.fire(PlotClientState.Rendered);
					this._completeRenderEmitter.fire(this._lastRender);
				} else if (response.msg_type === PlotClientMessageTypeOutput.Error) {
					const err = response as IPlotClientMessageError;
					request.error(new Error(`Failed to render plot: ${err.message}`));

					// TODO: Do we want to have a separate state for this case, or
					// return to the unrendered state?
				}
			}

			// If there is a queued render request, promote it to the current
			// request and perform it now. Queued renders don't have cooldown
			// period; they are already deferred because they were requested
			// while a render was in progress.
			if (this._queuedRender) {
				const queuedRender = this._queuedRender;
				this._queuedRender = undefined;
				this._currentRender = queuedRender;
				this.scheduleRender(queuedRender, 0);
			}
		});
	}

	/**
	 * Returns the last rendered plot, if any.
	 */
	get lastRender(): IRenderedPlot | undefined {
		return this._lastRender;
	}

	/**
	 * Returns the plot's unique ID.
	 */
	get id(): string {
		return this.metadata.id;
	}

	/**
	 * Returns an estimate for the time it will take to render the plot, in milliseconds.
	 *
	 * Currently, this is just the time it took for the last succesful render to
	 * complete. In the future, we may want to use a more sophisticated
	 * algorithm to estimate the render time.
	 */
	get renderEstimateMs(): number {
		return this._lastRenderTimeMs;
	}

	/**
	 * Queues a plot update request, if necessary.
	 */
	private queuePlotUpdateRequest() {
		if (this._queuedRender) {
			// There is already a queued render request; it will take care of
			// updating the plot.
			return;
		}

		// If we have never rendered this plot, we can't process any updates
		// yet.
		if (!this._currentRender && !this._lastRender) {
			return;
		}

		// Use the dimensions of the last or current render request to determine
		// the size and DPI of the plot to update.
		const height = this._currentRender?.renderRequest.height ??
			this._lastRender?.height;
		const width = this._currentRender?.renderRequest.width ??
			this._lastRender?.width;
		const pixel_ratio = this._currentRender?.renderRequest.pixel_ratio ??
			this._lastRender?.pixel_ratio;

		// If there is already a render request in flight, cancel it. This
		// should be exceedingly rare since if the kernel is busy processing a
		// render request, it is unlikely that it will also -- simultaneously --
		// be processing a request from the user that changes the plot.
		if (this._currentRender && !this._currentRender.isComplete) {
			this._currentRender.cancel();
			this._currentRender = undefined;
		}

		// Create and schedule a render request to update the plot, and execute
		// it right away. `scheduleRender` takes care of cancelling the render
		// timer for any previously deferred render requests.
		const req = new DeferredRender({
			msg_type: PlotClientMessageTypeInput.Render,
			height: height!,
			width: width!,
			pixel_ratio: pixel_ratio!
		});

		this.scheduleRender(req, 0);
	}
}
