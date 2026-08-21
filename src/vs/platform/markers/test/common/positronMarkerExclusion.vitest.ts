/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../base/common/uri.js';
import { IMarkerData, MarkerSeverity } from '../../common/markers.js';
import { MarkerService } from '../../common/markerService.js';

/**
 * Marker changes are delivered on a microtask, so nothing that reacts to one has
 * happened yet when `changeOne` returns.
 */
function flushMarkerChanges(): Promise<void> {
	return new Promise<void>(resolve => queueMicrotask(resolve));
}

function marker(message: string): IMarkerData {
	return {
		severity: MarkerSeverity.Error,
		message,
		startLineNumber: 1,
		startColumn: 1,
		endLineNumber: 1,
		endColumn: 5,
	};
}

describe('MarkerService resource exclusion', () => {
	let service: MarkerService;

	/** Stands in for a hidden Quarto cell: a resource the user cannot open. */
	const cell = URI.parse('vscode-notebook-cell:///test/doc.qmd#ch1');
	const source = URI.file('/test/doc.qmd');

	beforeEach(() => {
		service = new MarkerService();
	});

	afterEach(() => {
		service.dispose();
	});

	it('leaves an excluded resource out of every read, and only that resource', () => {
		service.changeOne('ark', cell, [marker('cell problem')]);
		service.changeOne('ark', source, [marker('source problem')]);

		service.installResourceExclusion(cell);

		expect({
			all: service.read().map(m => m.message),
			byOwner: service.read({ owner: 'ark' }).map(m => m.message),
			byResource: service.read({ resource: cell }).map(m => m.message),
			byOwnerAndResource: service.read({ owner: 'ark', resource: cell }).map(m => m.message),
			otherResource: service.read({ resource: source }).map(m => m.message),
		}).toEqual({
			all: ['source problem'],
			byOwner: ['source problem'],
			byResource: [],
			byOwnerAndResource: [],
			otherResource: ['source problem'],
		});
	});

	it('still reports the markers to a read that ignores resource filters', () => {
		service.changeOne('ark', cell, [marker('cell problem')]);

		service.installResourceExclusion(cell);

		// This is the read the owner of the markers uses, so excluding a resource
		// never costs anyone the markers themselves.
		expect({
			all: service.read({ ignoreResourceFilters: true }).map(m => m.message),
			byResource: service.read({ resource: cell, ignoreResourceFilters: true })
				.map(m => m.message),
			byOwnerAndResource: service.read({ owner: 'ark', resource: cell, ignoreResourceFilters: true })
				.map(m => m.message),
		}).toEqual({
			all: ['cell problem'],
			byResource: ['cell problem'],
			byOwnerAndResource: ['cell problem'],
		});
	});

	it('reports no placeholder marker, which is what separates it from a resource filter', () => {
		const paused = URI.file('/test/paused.ts');
		service.changeOne('ark', cell, [marker('cell problem')]);
		service.changeOne('ark', paused, [marker('paused problem')]);

		service.installResourceExclusion(cell);
		service.installResourceFilter(paused, 'Test filter');

		// A filtered resource keeps an entry in the Problems pane, explaining that
		// its problems are paused. An excluded one has nothing to explain: the
		// markers are shown somewhere else, on a resource of their own.
		expect({
			excluded: service.read({ resource: cell }).map(m => m.owner),
			filtered: service.read({ resource: paused }).map(m => m.owner),
		}).toEqual({
			excluded: [],
			filtered: ['markersFilter'],
		});
	});

	it('stays excluded until every exclusion is disposed', () => {
		service.changeOne('ark', cell, [marker('cell problem')]);
		const first = service.installResourceExclusion(cell);
		const second = service.installResourceExclusion(cell);

		const whileBoth = service.read({ resource: cell }).length;
		first.dispose();
		const whileOne = service.read({ resource: cell }).length;
		second.dispose();
		const whileNone = service.read({ resource: cell }).length;

		expect({ whileBoth, whileOne, whileNone })
			.toEqual({ whileBoth: 0, whileOne: 0, whileNone: 1 });
	});

	it('ignores a repeated dispose of the same exclusion', () => {
		service.changeOne('ark', cell, [marker('cell problem')]);
		const first = service.installResourceExclusion(cell);
		const second = service.installResourceExclusion(cell);

		// Disposing one exclusion twice must not release the other one's hold.
		first.dispose();
		first.dispose();

		expect({
			afterRepeat: service.read({ resource: cell }).length,
			afterSecond: (second.dispose(), service.read({ resource: cell }).length),
		}).toEqual({
			afterRepeat: 0,
			afterSecond: 1,
		});
	});

	it('fires a marker change for the resource when installed and when released', async () => {
		const changes: string[][] = [];
		const listener = service.onMarkerChanged(
			resources => changes.push(resources.map(resource => resource.toString())));

		const exclusion = service.installResourceExclusion(cell);
		await flushMarkerChanges();
		exclusion.dispose();
		await flushMarkerChanges();
		listener.dispose();

		// Whatever is showing the markers has to be told to read again, in both
		// directions, or it keeps rendering the state from before.
		expect(changes).toEqual([[cell.toString()], [cell.toString()]]);
	});

	it('keeps the markers of an excluded resource out of the statistics', async () => {
		service.changeOne('ark', cell, [marker('cell problem')]);
		service.changeOne('ark', source, [marker('source problem')]);
		await flushMarkerChanges();
		const before = service.getStatistics().errors;

		service.installResourceExclusion(cell);
		await flushMarkerChanges();

		// The status bar counts read through the same statistics, so an excluded
		// resource must not be counted there either.
		expect({ before, after: service.getStatistics().errors })
			.toEqual({ before: 2, after: 1 });
	});
});
