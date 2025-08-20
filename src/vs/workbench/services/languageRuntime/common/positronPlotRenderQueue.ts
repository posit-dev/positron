/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../base/common/async.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IPlotSize } from '../../positronPlots/common/sizingPolicy.js';
import { ILanguageRuntimeSession } from '../../runtimeSession/common/runtimeSessionService.js';
import { RuntimeState } from './languageRuntimeService.js';
import { PlotRenderFormat, PositronPlotComm, IntrinsicSize } from './positronPlotComm.js';
import { padBase64 } from './utils.js';

/**
 * The type of operation being queued.
 */
export enum OperationType {
	Render = 'render',
	GetIntrinsicSize = 'get_intrinsic_size'
}

/**
 * The result of a plot operation.
 */
export type PlotOperationResult = IRenderedPlot | IntrinsicSize | undefined;

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
 * A request to perform an operation on a plot (render or get intrinsic size).
 */
export interface PlotOperationRequest {
	/**
	 * The type of operation to perform.
	 */
	type: OperationType;

	/**
	 * For render operations: the size of the plot, in logical pixels.
	 * If undefined, the plot will be rendered at its intrinsic size, if known.
	 * For intrinsic size operations: not used.
	 */
	size?: IPlotSize;

	/** For render operations: the pixel ratio of the device for which the plot was rendered */
	pixel_ratio?: number;

	/** For render operations: the format of the plot */
	format?: PlotRenderFormat;
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
 * A deferred plot operation request. Used to track the state of an operation request
 * that hasn't been fulfilled; mostly a thin wrapper over a `DeferredPromise` that
 * includes the original operation request.
 */
export class DeferredPlotOperation {
	private readonly deferred: DeferredPromise<PlotOperationResult>;

	constructor(public readonly operationRequest: PlotOperationRequest) {
		this.deferred = new DeferredPromise<PlotOperationResult>();
	}

	/**
	 * Whether the operation request has been completed in some way (either by
	 * completing successfully, or by being cancelled or errored).
	 */
	get isComplete(): boolean {
		return this.deferred.isSettled;
	}

	/**
	 * Cancel the operation request.
	 */
	cancel(): void {
		this.deferred.cancel();
	}

	/**
	 * Report an error to the operation request.
	 */
	error(err: Error): void {
		this.deferred.error(err);
	}

	/**
	 * Complete the operation request.
	 */
	complete(result: PlotOperationResult): void {
		this.deferred.complete(result);
	}

	get promise(): Promise<PlotOperationResult> {
		return this.deferred.p;
	}
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

export class QueuedOperation {
	constructor(
		public readonly operation: DeferredPlotOperation,
		public readonly comm: PositronPlotComm) {
	}
}

export class QueuedRender {
	constructor(
		public readonly render: DeferredRender,
		public readonly comm: PositronPlotComm) {
	}
}

/**
 * This class manages a queue of plot operations (rendering and intrinsic size
 * requests) for a given runtime session.
 *
 * We queue the plot operations to ensure that only one operation is performed
 * at a time; otherwise, operations such as generating a batch of plots in a
 * loop can result in multiple plots all trying to render at once, which can
 * result in some of them timing out.
 */
export class PositronPlotRenderQueue extends Disposable {
	private readonly _queue: QueuedOperation[] = [];
	private _isProcessing = false;

	/**
	 * Map of comm close listeners, keyed by comm client ID. This ensures we only
	 * register one listener per comm and can clean them up properly.
	 */
	private readonly _commCloseListeners = new Map<string, IDisposable>();

	constructor(
		private readonly _session: ILanguageRuntimeSession,
		private readonly _logService: ILogService
	) {
		super();
		this.trace(`Initializing`);
		this._register(this._session.onDidChangeRuntimeState(() => {

			if (this._session.getRuntimeState() === RuntimeState.Idle ||
				this._session.getRuntimeState() === RuntimeState.Ready) {
				if (this._queue.length > 0) {
					this.trace(`Runtime ready, processing queue.`);
					this.processQueue();
				}
			} else if (this._session.getRuntimeState() === RuntimeState.Exited) {
				this._queue.forEach((queuedOperation) => {
					queuedOperation.operation.cancel();
					this.trace(
						`Runtime exited, cancelling operation: ` +
						`${JSON.stringify(queuedOperation.operation.operationRequest)} (${queuedOperation.comm.clientId})`);
				});
				this._queue.length = 0;
			}
		}));
	}

	/**
	 * Queue a plot operation request.
	 *
	 * @param request The operation request to queue
	 * @param comm The comm to use for the operation
	 */
	public queueOperation(request: PlotOperationRequest, comm: PositronPlotComm): DeferredPlotOperation {
		const deferredOperation = new DeferredPlotOperation(request);
		this._queue.push(new QueuedOperation(deferredOperation, comm));

		// Ensure we have a close listener for this comm
		this.ensureCommCloseListener(comm);

		this.trace(
			`Received request for ${request.type} operation: ` +
			JSON.stringify(request) +
			` (${comm.clientId}); queue length: ${this._queue.length})`);

		// If the session is idle or ready, start processing the queue.
		if (this._session.getRuntimeState() === RuntimeState.Idle || this._session.getRuntimeState() === RuntimeState.Ready) {
			this.processQueue();
		}
		return deferredOperation;
	}

	/**
	 * Queue a render request.
	 *
	 * @param request The render request to queue
	 */
	public queue(deferredRender: DeferredRender, comm: PositronPlotComm): DeferredRender {

		// Cancel and remove any existing render operations for the same plot
		this.cancelExistingOperations(comm, OperationType.Render);

		// Convert render request to operation request for unified handling
		const operationRequest: PlotOperationRequest = {
			type: OperationType.Render,
			size: deferredRender.renderRequest.size,
			pixel_ratio: deferredRender.renderRequest.pixel_ratio,
			format: deferredRender.renderRequest.format
		};

		const deferredOperation = this.queueOperation(operationRequest, comm);

		// Bridge the operation result to the render result
		deferredOperation.promise.then((result) => {
			if (result && typeof result === 'object' && 'uri' in result) {
				deferredRender.complete(result as IRenderedPlot);
			} else {
				deferredRender.error(new Error('Invalid render result'));
			}
		}).catch((err) => {
			deferredRender.error(err);
		});

		return deferredRender;
	}

	/**
	 * Queue an intrinsic size request.
	 *
	 * @param comm The comm to use for the operation
	 */
	public queueIntrinsicSizeRequest(comm: PositronPlotComm): Promise<IntrinsicSize | undefined> {
		// Cancel any existing intrinsic size requests for the same plot
		this.cancelExistingOperations(comm, OperationType.GetIntrinsicSize);

		const operationRequest: PlotOperationRequest = {
			type: OperationType.GetIntrinsicSize
		};

		const deferredOperation = this.queueOperation(operationRequest, comm);
		return deferredOperation.promise.then((result) => {
			if (result === null) {
				return undefined; // No intrinsic size available
			} else if (result === undefined ||
				(typeof result === 'object' && 'width' in result && 'height' in result)) {
				return result as IntrinsicSize | undefined;
			} else {
				throw new Error('Invalid intrinsic size result');
			}
		});
	}

	/**
	 * Cancel existing operations in the queue for the same plot and operation
	 * type.  Used to avoid unnecessary work, e.g. when a new render request is
	 * made before the previous one has started processing.
	 *
	 * @param comm The comm to match against
	 * @param operationType The type of operation to cancel
	 */
	private cancelExistingOperations(comm: PositronPlotComm, operationType: OperationType): void {
		// Iterate through the queue in reverse order to safely remove items
		for (let i = this._queue.length - 1; i >= 0; i--) {
			const queuedOperation = this._queue[i];

			// Check if this is the same plot and operation type
			if (queuedOperation.comm.clientId === comm.clientId &&
				queuedOperation.operation.operationRequest.type === operationType) {

				// Cancel the operation
				queuedOperation.operation.cancel();

				// Remove it from the queue
				this._queue.splice(i, 1);

				this.trace(`Cancelled existing ${operationType} operation for plot ${comm.clientId}`);
			}
		}
	}

	/**
	 * Process the operation queue. If an operation is already in progress, this will
	 * do nothing.
	 */
	private processQueue(): void {
		// Nothing to do if the queue is empty.
		if (this._queue.length === 0) {
			this._isProcessing = false;
			// Clean up any unused close listeners when queue is empty
			this.cleanupUnusedCloseListeners();
			return;
		}

		// Don't allow re-entrant processing.
		if (this._isProcessing) {
			return;
		}

		this._isProcessing = true;
		const queuedOperation = this._queue.shift();
		if (!queuedOperation) {
			this._isProcessing = false;
			return;
		}

		this.trace(`Processing ${queuedOperation.operation.operationRequest.type} request: ` +
			`${JSON.stringify(queuedOperation.operation.operationRequest)} ` +
			`(${queuedOperation.comm.clientId}); queue length: ${this._queue.length})`);

		// Record the time that the operation started
		const startedTime = Date.now();
		const operationRequest = queuedOperation.operation.operationRequest;

		if (operationRequest.type === OperationType.Render) {
			// Handle render operation
			queuedOperation.comm.render(operationRequest.size,
				operationRequest.pixel_ratio!,
				operationRequest.format!).then((response) => {
					// The render was successful; record the render time
					const finishedTime = Date.now();
					const renderTimeMs = finishedTime - startedTime;

					// The server returned a rendered plot image; save it and resolve the promise
					const uri = `data:${response.mime_type};base64,${padBase64(response.data)}`;
					const renderResult: IRenderedPlot = {
						size: operationRequest.size,
						pixel_ratio: operationRequest.pixel_ratio!,
						uri,
						renderTimeMs
					};
					queuedOperation.operation.complete(renderResult);
				}).catch((err) => {
					queuedOperation.operation.error(err);
				}).finally(() => {
					// Mark processing as complete and process the next item in the queue
					this._isProcessing = false;
					this.processQueue();
				});
		} else if (operationRequest.type === OperationType.GetIntrinsicSize) {
			// Handle intrinsic size operation
			queuedOperation.comm.getIntrinsicSize().then((intrinsicSize) => {
				queuedOperation.operation.complete(intrinsicSize);
			}).catch((err) => {
				// Handle the error
				queuedOperation.operation.error(err);
			}).finally(() => {
				// Mark processing as complete and process the next item in the queue
				this._isProcessing = false;
				this.processQueue();
			});
		} else {
			// Unknown operation type
			queuedOperation.operation.error(new Error(`Unknown operation type: ${operationRequest.type}`));
			this._isProcessing = false;
			this.processQueue();
		}
	}

	/**
	 * Emit a trace log message for the render queue.
	 *
	 * @param message The message to log
	 */
	private trace(message: string): void {
		this._logService.trace(`[RenderQueue ${this._session.sessionId}] ${message}`);
	}

	/**
	 * Ensure that a close listener is registered for the given comm.
	 *
	 * @param comm The comm to register a close listener for
	 */
	private ensureCommCloseListener(comm: PositronPlotComm): void {
		const clientId = comm.clientId;

		// If we already have a listener for this comm, don't register another
		if (this._commCloseListeners.has(clientId)) {
			return;
		}

		// Register a close listener for this comm
		const closeListener = comm.onDidClose(() => {
			this.cancelOperationsForClosedComm(clientId);
			// Clean up the listener from our map
			this._commCloseListeners.delete(clientId);
		});
		this._commCloseListeners.set(clientId, closeListener);
	}

	/**
	 * Cancel all pending operations for a comm that has closed.
	 *
	 * @param clientId The client ID of the comm that closed
	 */
	private cancelOperationsForClosedComm(clientId: string): void {
		let cancelledCount = 0;

		// Iterate through the queue in reverse order to safely remove items
		for (let i = this._queue.length - 1; i >= 0; i--) {
			const queuedOperation = this._queue[i];

			// Check if this operation belongs to the closed comm
			if (queuedOperation.comm.clientId === clientId) {
				// Cancel the operation
				queuedOperation.operation.cancel();

				// Remove it from the queue
				this._queue.splice(i, 1);
				cancelledCount++;
			}
		}

		if (cancelledCount > 0) {
			this.trace(`Cancelled ${cancelledCount} operations for closed comm ${clientId}`);
		}
	}

	/**
	 * Clean up close listeners for comms that no longer have any operations in the queue.
	 * This helps prevent memory leaks by removing unnecessary listeners.
	 */
	private cleanupUnusedCloseListeners(): void {
		// Get all comm client IDs that currently have operations in the queue
		const activeCommIds = new Set(this._queue.map(op => op.comm.clientId));

		// Find close listeners for comms that are no longer in the queue
		const unusedListeners: string[] = [];
		for (const [clientId] of this._commCloseListeners) {
			if (!activeCommIds.has(clientId)) {
				unusedListeners.push(clientId);
			}
		}

		// Dispose and remove unused listeners
		for (const clientId of unusedListeners) {
			const listener = this._commCloseListeners.get(clientId);
			if (listener) {
				listener.dispose();
				this._commCloseListeners.delete(clientId);
			}
		}
	}

	/**
	 * Override dispose to clean up all close listeners when the render queue is disposed.
	 */
	override dispose(): void {
		// Cancel any remaining operations in the queue
		for (const queuedOperation of this._queue) {
			queuedOperation.operation.cancel();
		}
		this._queue.length = 0;

		// Dispose all close listeners
		for (const [clientId, listener] of this._commCloseListeners) {
			listener.dispose();
			this.trace(`Cleaned up close listener for comm ${clientId}`);
		}
		this._commCloseListeners.clear();

		super.dispose();
	}
}

