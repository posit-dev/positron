/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { PlotPoint } from '../../languageRuntime/common/positronUiComm.js';
import { IPlotSize } from './sizingPolicy.js';

/**
 * Identifies the plot a locator() call is waiting on.
 */
export interface IPlotLocator {
	readonly sessionId: string;
	readonly plotId: string;
	/**
	 * The size of the plot image the kernel sent for this request, in logical pixels. The point
	 * maps to the plot only on an image of this size, so other images take no clicks.
	 */
	readonly size: IPlotSize;
	/** The ID of the execute request that waits for the point, if known. */
	readonly executionId?: string;
}

/**
 * Whether `locator` waits on the plot `plotId` of the session `sessionId`.
 */
export function isLocatorForPlot(locator: IPlotLocator | undefined, sessionId: string, plotId: string): locator is IPlotLocator {
	return locator?.plotId === plotId && locator.sessionId === sessionId;
}

/**
 * The points the user chose on a plot, shown as markers until the kernel draws the plot again.
 * locator() and identify() send one request per point, so the points outlive each request.
 */
export interface IPlotLocatorPoints {
	readonly sessionId: string;
	readonly plotId: string;
	/** The size of the plot image the points were chosen on, in logical pixels. */
	readonly size: IPlotSize;
	readonly points: readonly PlotPoint[];
}

/**
 * Whether `points` were chosen on the plot `plotId` of the session `sessionId`.
 */
export function arePointsForPlot(points: IPlotLocatorPoints | undefined, sessionId: string, plotId: string): points is IPlotLocatorPoints {
	return points?.plotId === plotId && points.sessionId === sessionId;
}

/**
 * Tracks the single active locator request, and the points chosen so far.
 */
export class PlotLocatorState extends Disposable {
	private _active?: { locator: IPlotLocator; result: DeferredPromise<PlotPoint | undefined> };

	/** The points chosen so far, with the locator request of the last one. */
	private _chosen?: { locator: IPlotLocator; points: PlotPoint[] };

	private readonly _onDidChangeLocator = this._register(new Emitter<IPlotLocator | undefined>());

	private readonly _onDidChangePoints = this._register(new Emitter<IPlotLocatorPoints | undefined>());

	readonly onDidChangeLocator: Event<IPlotLocator | undefined> = this._onDidChangeLocator.event;

	readonly onDidChangePoints: Event<IPlotLocatorPoints | undefined> = this._onDidChangePoints.event;

	get activeLocator(): IPlotLocator | undefined {
		return this._active?.locator;
	}

	/**
	 * The points chosen during the current execute request. They stay between the requests of
	 * one execute request and go away when it ends, when the user finishes, or when a request
	 * arrives for another plot or image size.
	 */
	get points(): IPlotLocatorPoints | undefined {
		if (!this._chosen) {
			return undefined;
		}
		const { sessionId, plotId, size } = this._chosen.locator;
		return { sessionId, plotId, size, points: this._chosen.points };
	}

	/** Starts a locator. An active one is resolved with `undefined` first. */
	begin(locator: IPlotLocator): Promise<PlotPoint | undefined> {
		this.resolve(undefined);
		const chosen = this._chosen?.locator;
		if (chosen && (
			chosen.sessionId !== locator.sessionId ||
			chosen.plotId !== locator.plotId ||
			chosen.executionId !== locator.executionId ||
			chosen.size.width !== locator.size.width ||
			chosen.size.height !== locator.size.height
		)) {
			this._clearPoints();
		}
		const result = new DeferredPromise<PlotPoint | undefined>();
		this._active = { locator, result };
		this._onDidChangeLocator.fire(locator);
		return result.p;
	}

	/** Resolves the active locator. Does nothing when none is active. */
	resolve(point: PlotPoint | undefined): void {
		const active = this._active;
		if (!active) {
			return;
		}
		this._active = undefined;
		active.result.complete(point);
		if (point) {
			this._chosen = { locator: active.locator, points: [...this._chosen?.points ?? [], point] };
			this._onDidChangePoints.fire(this.points);
		} else {
			this._clearPoints();
		}
		this._onDidChangeLocator.fire(undefined);
	}

	/** Ends the locator of the session: see `_cancel`. */
	cancelSession(sessionId: string): void {
		this._cancel(locator => locator.sessionId === sessionId);
	}

	/**
	 * Ends the locator of the execute request, which has ended: see `_cancel`. With no
	 * `executionId`, ends the locator of the session if its execute request is not known.
	 */
	cancelExecution(sessionId: string, executionId: string | undefined): void {
		this._cancel(locator => locator.sessionId === sessionId && locator.executionId === executionId);
	}

	/** Ends the locator of the plot: see `_cancel`. */
	cancelPlot(plotId: string): void {
		this._cancel(locator => locator.plotId === plotId);
	}

	/**
	 * Resolves the active locator with `undefined` and removes the chosen points, each only if
	 * its locator request matches.
	 */
	private _cancel(matches: (locator: IPlotLocator) => boolean): void {
		if (this._active && matches(this._active.locator)) {
			this.resolve(undefined);
		}
		if (this._chosen && matches(this._chosen.locator)) {
			this._clearPoints();
		}
	}

	private _clearPoints(): void {
		if (this._chosen) {
			this._chosen = undefined;
			this._onDidChangePoints.fire(undefined);
		}
	}

	override dispose(): void {
		this.resolve(undefined);
		this._clearPoints();
		super.dispose();
	}
}

export interface IBox {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * Converts a click to a fraction of the plot image.
 * `box` is the <img> element's bounding client rect. With `contain`, the bitmap is
 * scaled to fit inside `box` and centered (CSS `object-fit: contain`); otherwise it fills `box`.
 * Returns `undefined` for a click outside the bitmap or when a size is zero.
 */
export function plotPointFromClick(
	box: IBox,
	natural: { width: number; height: number },
	client: { x: number; y: number },
	contain: boolean
): PlotPoint | undefined {
	if (box.width <= 0 || box.height <= 0 || natural.width <= 0 || natural.height <= 0) {
		return undefined;
	}

	let left = box.left;
	let top = box.top;
	let width = box.width;
	let height = box.height;
	if (contain) {
		const scale = Math.min(box.width / natural.width, box.height / natural.height);
		width = natural.width * scale;
		height = natural.height * scale;
		left += (box.width - width) / 2;
		top += (box.height - height) / 2;
	}

	const x = (client.x - left) / width;
	const y = (client.y - top) / height;
	if (x < 0 || x > 1 || y < 0 || y > 1) {
		return undefined;
	}
	return { x, y };
}

/**
 * Returns the box of the plot bitmap that PanZoomImage shows, relative to the top left corner of
 * its scrollable content. This is the inverse of the layout that PanZoomImage gives the image:
 * at Fit zoom the bitmap is scaled to fit the container and centered; at other zoom levels it has
 * its natural size times the zoom level, and is centered on each axis where it is smaller than
 * the container.
 * @param container The size of the area that shows the image.
 * @param natural The natural size of the bitmap.
 * @param zoom The zoom level as a scale multiplier, or 0 for Fit.
 */
export function plotImageBox(
	container: { width: number; height: number },
	natural: { width: number; height: number },
	zoom: number
): IBox {
	if (natural.width <= 0 || natural.height <= 0) {
		return { left: 0, top: 0, width: 0, height: 0 };
	}
	const scale = zoom === 0 ?
		Math.min(container.width / natural.width, container.height / natural.height) :
		zoom;
	const width = natural.width * scale;
	const height = natural.height * scale;
	return {
		left: Math.max((container.width - width) / 2, 0),
		top: Math.max((container.height - height) / 2, 0),
		width,
		height,
	};
}
