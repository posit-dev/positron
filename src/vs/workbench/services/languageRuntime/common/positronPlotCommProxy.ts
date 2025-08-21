/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { IRuntimeClientInstance, RuntimeClientState } from './languageRuntimeClientInstance.js';
import { IntrinsicSize, PositronPlotComm, UpdateEvent } from './positronPlotComm.js';
import { DeferredRender, PositronPlotRenderQueue } from './positronPlotRenderQueue.js';


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
	 * render parameters. May include a pre-rendering for immediate display.
	 */
	onDidRenderUpdate: Event<UpdateEvent>;
	private readonly _renderUpdateEmitter = new Emitter<UpdateEvent>();

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
		client: IRuntimeClientInstance<any, any>,
		private readonly _sessionRenderQueue: PositronPlotRenderQueue) {
		super();

		this._comm = new PositronPlotComm(client, { render: { timeout: 30000 }, get_intrinsic_size: { timeout: 30000 } });

		this._register(this._closeEmitter);
		this._register(this._renderUpdateEmitter);
		this._register(this._didShowPlotEmitter);
		this._register(this._didSetIntrinsicSizeEmitter);

		const clientStateEvent = Event.fromObservable(client.clientState);

		// Connect close emitter event
		this.onDidClose = this._closeEmitter.event;
		this._register(clientStateEvent((state) => {
			if (state === RuntimeClientState.Closed) {
				this._closeEmitter.fire();

				// Silently cancel any pending render requests
				this._currentRender?.cancel();
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

		this._register(this._comm.onDidUpdate((evt) => {
			this._renderUpdateEmitter.fire(evt);
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

		// If we have already received the intrinsic size, return it immediately.
		if (this._receivedIntrinsicSize) {
			return Promise.resolve(this._intrinsicSize);
		}

		// Use the session render queue to ensure operations don't overlap
		this._currentIntrinsicSize = this._sessionRenderQueue.queueIntrinsicSizeRequest(this._comm)
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
		this._currentRender = request;

		// The session render queue will handle scheduling and rendering
		this._sessionRenderQueue.queue(request, this._comm);
	}
}
