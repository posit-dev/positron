/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { PlotPoint } from '../../languageRuntime/common/positronUiComm.js';

/**
 * Identifies the plot a locator() call is waiting on.
 */
export interface IPlotLocator {
	readonly sessionId: string;
	readonly plotId: string;
	/** The ID of the execute request that waits for the point, if known. */
	readonly executionId?: string;
}

/**
 * Tracks the single active locator request.
 */
export class PlotLocatorState extends Disposable {
	private _active?: { locator: IPlotLocator; result: DeferredPromise<PlotPoint | undefined> };

	private readonly _onDidChangeLocator = this._register(new Emitter<IPlotLocator | undefined>());

	readonly onDidChangeLocator: Event<IPlotLocator | undefined> = this._onDidChangeLocator.event;

	get activeLocator(): IPlotLocator | undefined {
		return this._active?.locator;
	}

	/** Starts a locator. An active one is resolved with `undefined` first. */
	begin(locator: IPlotLocator): Promise<PlotPoint | undefined> {
		this.resolve(undefined);
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
		this._onDidChangeLocator.fire(undefined);
	}

	/** Resolves the active locator with `undefined` if it belongs to the session. */
	cancelSession(sessionId: string): void {
		if (this._active?.locator.sessionId === sessionId) {
			this.resolve(undefined);
		}
	}

	/** Resolves the active locator with `undefined` if the execute request it belongs to has ended. */
	cancelExecution(sessionId: string, executionId: string): void {
		const locator = this._active?.locator;
		if (locator?.sessionId === sessionId && locator.executionId === executionId) {
			this.resolve(undefined);
		}
	}

	/** Resolves the active locator with `undefined` if it targets the plot. */
	cancelPlot(plotId: string): void {
		if (this._active?.locator.plotId === plotId) {
			this.resolve(undefined);
		}
	}

	override dispose(): void {
		this.resolve(undefined);
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
