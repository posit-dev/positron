/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { arePointsForPlot, isLocatorForPlot, plotImageBox, PlotLocatorState, plotPointFromClick } from '../../common/plotLocator.js';

describe('PlotLocatorState', () => {
	const size = { width: 400, height: 300 };
	const a = { sessionId: 's1', plotId: 'p1', size };
	const b = { sessionId: 's2', plotId: 'p2', size };

	function create() {
		const state = new PlotLocatorState();
		const events: unknown[] = [];
		state.onDidChangeLocator(e => events.push(e));
		return { state, events };
	}

	it('begin activates and resolve completes with the point', async () => {
		const { state, events } = create();
		const promise = state.begin(a);
		expect(state.activeLocator).toEqual(a);
		state.resolve({ x: 0.5, y: 0.5 });
		expect({
			result: await promise,
			active: state.activeLocator,
			events,
		}).toEqual({ result: { x: 0.5, y: 0.5 }, active: undefined, events: [a, undefined] });
		state.dispose();
	});

	it('resolve(undefined) resolves with undefined', async () => {
		const { state } = create();
		const promise = state.begin(a);
		state.resolve(undefined);
		expect(await promise).toBeUndefined();
		state.dispose();
	});

	it('a second begin cancels the first and stays active', async () => {
		const { state } = create();
		const first = state.begin(a);
		const second = state.begin(b);
		expect({ first: await first, active: state.activeLocator }).toEqual({ first: undefined, active: b });
		state.resolve({ x: 1, y: 0 });
		expect(await second).toEqual({ x: 1, y: 0 });
		state.dispose();
	});

	it('cancelSession and cancelPlot ignore other IDs', () => {
		const { state, events } = create();
		state.begin(a);
		state.cancelSession('other');
		state.cancelPlot('other');
		expect({ active: state.activeLocator, events }).toEqual({ active: a, events: [a] });
		state.dispose();
	});

	it('cancelSession resolves a matching locator with undefined', async () => {
		const { state } = create();
		const promise = state.begin(a);
		state.cancelSession('s1');
		expect({ result: await promise, active: state.activeLocator }).toEqual({ result: undefined, active: undefined });
		state.dispose();
	});

	it('cancelPlot resolves a matching locator with undefined', async () => {
		const { state } = create();
		const promise = state.begin(a);
		state.cancelPlot('p1');
		expect({ result: await promise, active: state.activeLocator }).toEqual({ result: undefined, active: undefined });
		state.dispose();
	});

	it('resolve with nothing active does nothing', () => {
		const { state, events } = create();
		expect(() => state.resolve({ x: 0, y: 0 })).not.toThrow();
		expect(events).toEqual([]);
		state.dispose();
	});

	it('dispose resolves an active locator with undefined', async () => {
		const { state } = create();
		const promise = state.begin(a);
		state.dispose();
		expect(await promise).toBeUndefined();
	});
});

describe('PlotLocatorState points', () => {
	const size = { width: 400, height: 300 };
	const a = { sessionId: 's1', plotId: 'p1', size, executionId: 'e1' };
	const p1 = { x: 0.1, y: 0.2 };
	const p2 = { x: 0.3, y: 0.4 };

	/** Creates a state where the user chose `p1` and `p2` for two requests like `a`. */
	function createWithPoints() {
		const state = new PlotLocatorState();
		void state.begin(a);
		state.resolve(p1);
		void state.begin({ ...a });
		state.resolve(p2);
		const events: unknown[] = [];
		state.onDidChangePoints(e => events.push(e?.points));
		return { state, events };
	}

	it('keeps the points of the requests of one execute request', () => {
		const state = new PlotLocatorState();
		const events: unknown[] = [];
		state.onDidChangePoints(e => events.push(e?.points));
		void state.begin(a);
		state.resolve(p1);
		void state.begin({ ...a });
		state.resolve(p2);
		expect({ points: state.points, events }).toEqual({
			points: { sessionId: 's1', plotId: 'p1', size, points: [p1, p2] },
			events: [[p1], [p1, p2]],
		});
		state.dispose();
	});

	it('removes the points when the user finishes', () => {
		const { state, events } = createWithPoints();
		void state.begin({ ...a });
		state.resolve(undefined);
		expect({ points: state.points, events }).toEqual({ points: undefined, events: [undefined] });
		state.dispose();
	});

	it.each([
		['another plot', { ...a, plotId: 'p2' }],
		['another session', { ...a, sessionId: 's2' }],
		['another execute request', { ...a, executionId: 'e2' }],
		['another image size', { ...a, size: { width: 500, height: 300 } }],
	])('removes the points when a request starts for %s', (_name, next) => {
		const { state } = createWithPoints();
		void state.begin(next);
		expect(state.points).toBeUndefined();
		state.dispose();
	});

	it('removes the points when their execute request, session, or plot ends', () => {
		const removed = [
			(state: PlotLocatorState) => state.cancelExecution('s1', 'e1'),
			(state: PlotLocatorState) => state.cancelSession('s1'),
			(state: PlotLocatorState) => state.cancelPlot('p1'),
		].map(cancel => {
			const { state } = createWithPoints();
			cancel(state);
			const points = state.points;
			state.dispose();
			return points;
		});
		expect(removed).toEqual([undefined, undefined, undefined]);
	});

	it('keeps the points when something else ends', () => {
		const { state, events } = createWithPoints();
		state.cancelExecution('s1', 'other');
		// The session goes idle after a comm request, with no execute request named.
		state.cancelExecution('s1', undefined);
		state.cancelSession('other');
		state.cancelPlot('other');
		expect({ points: state.points?.points, events }).toEqual({ points: [p1, p2], events: [] });
		state.dispose();
	});

	it('removes the points on any idle when the execute request is not known', () => {
		const state = new PlotLocatorState();
		void state.begin({ sessionId: 's1', plotId: 'p1', size });
		state.resolve(p1);
		state.cancelExecution('s1', undefined);
		expect(state.points).toBeUndefined();
		state.dispose();
	});
});

describe('arePointsForPlot', () => {
	const points = { sessionId: 's1', plotId: 'p1', size: { width: 400, height: 300 }, points: [] };

	it('matches only the same session and plot', () => {
		expect([
			arePointsForPlot(points, 's1', 'p1'),
			arePointsForPlot(points, 's2', 'p1'),
			arePointsForPlot(points, 's1', 'p2'),
			arePointsForPlot(undefined, 's1', 'p1'),
		]).toEqual([true, false, false, false]);
	});
});

describe('plotImageBox', () => {
	it('fits and centers the bitmap at Fit zoom', () => {
		expect({
			wide: plotImageBox({ width: 400, height: 100 }, { width: 200, height: 100 }, 0),
			tall: plotImageBox({ width: 100, height: 400 }, { width: 200, height: 400 }, 0),
		}).toEqual({
			wide: { left: 100, top: 0, width: 200, height: 100 },
			tall: { left: 0, top: 100, width: 100, height: 200 },
		});
	});

	it('scales by the zoom level and centers only an axis that is smaller than the container', () => {
		const container = { width: 400, height: 200 };
		const natural = { width: 200, height: 150 };
		expect({
			smaller: plotImageBox(container, natural, 1),
			tallerOnly: plotImageBox(container, natural, 1.5),
			larger: plotImageBox(container, natural, 4),
		}).toEqual({
			smaller: { left: 100, top: 25, width: 200, height: 150 },
			tallerOnly: { left: 50, top: 0, width: 300, height: 225 },
			larger: { left: 0, top: 0, width: 800, height: 600 },
		});
	});

	it('is the inverse of plotPointFromClick', () => {
		const container = { width: 400, height: 100 };
		const natural = { width: 200, height: 100 };
		const box = plotImageBox(container, natural, 0);
		const point = { x: 0.25, y: 0.5 };
		expect(plotPointFromClick(
			{ left: 0, top: 0, ...container },
			natural,
			{ x: box.left + point.x * box.width, y: box.top + point.y * box.height },
			true,
		)).toEqual(point);
	});

	it('gives an empty box for a bitmap with no size', () => {
		expect(plotImageBox({ width: 400, height: 100 }, { width: 0, height: 0 }, 0))
			.toEqual({ left: 0, top: 0, width: 0, height: 0 });
	});
});

describe('isLocatorForPlot', () => {
	const locator = { sessionId: 's1', plotId: 'p1', size: { width: 400, height: 300 } };

	it('matches only the same session and plot', () => {
		expect([
			isLocatorForPlot(locator, 's1', 'p1'),
			isLocatorForPlot(locator, 's2', 'p1'),
			isLocatorForPlot(locator, 's1', 'p2'),
			isLocatorForPlot(undefined, 's1', 'p1'),
		]).toEqual([true, false, false, false]);
	});
});

describe('plotPointFromClick', () => {
	it('maps a click in fill mode', () => {
		expect(plotPointFromClick(
			{ left: 100, top: 50, width: 400, height: 200 },
			{ width: 800, height: 400 },
			{ x: 200, y: 100 },
			false,
		)).toEqual({ x: 0.25, y: 0.25 });
	});

	it('maps a click in a wide contain box and rejects the letterbox', () => {
		const box = { left: 0, top: 0, width: 400, height: 100 };
		const natural = { width: 200, height: 100 };
		expect({
			inside: plotPointFromClick(box, natural, { x: 150, y: 50 }, true),
			outside: plotPointFromClick(box, natural, { x: 50, y: 50 }, true),
		}).toEqual({ inside: { x: 0.25, y: 0.5 }, outside: undefined });
	});

	it('maps a click in a tall contain box and rejects the letterbox', () => {
		const box = { left: 0, top: 0, width: 100, height: 400 };
		const natural = { width: 100, height: 200 };
		expect({
			inside: plotPointFromClick(box, natural, { x: 50, y: 150 }, true),
			outside: plotPointFromClick(box, natural, { x: 50, y: 50 }, true),
		}).toEqual({ inside: { x: 0.5, y: 0.25 }, outside: undefined });
	});

	it('gives 0 and 1 on the edges', () => {
		const box = { left: 10, top: 20, width: 100, height: 50 };
		const natural = { width: 100, height: 50 };
		expect({
			topLeft: plotPointFromClick(box, natural, { x: 10, y: 20 }, false),
			bottomRight: plotPointFromClick(box, natural, { x: 110, y: 70 }, false),
		}).toEqual({ topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } });
	});

	it('returns undefined for zero sizes', () => {
		expect({
			zeroBox: plotPointFromClick({ left: 0, top: 0, width: 0, height: 10 }, { width: 10, height: 10 }, { x: 0, y: 0 }, false),
			zeroNatural: plotPointFromClick({ left: 0, top: 0, width: 10, height: 10 }, { width: 0, height: 10 }, { x: 5, y: 5 }, true),
		}).toEqual({ zeroBox: undefined, zeroNatural: undefined });
	});
});
