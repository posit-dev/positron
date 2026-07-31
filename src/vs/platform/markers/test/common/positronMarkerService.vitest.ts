/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../base/common/uri.js';
import { IMarkerData, MarkerSeverity } from '../../common/markers.js';
import { PositronMarkerService } from '../../common/positronMarkerService.js';

function markerData(message: string): IMarkerData {
	return {
		severity: MarkerSeverity.Error,
		message,
		startLineNumber: 1,
		startColumn: 1,
		endLineNumber: 1,
		endColumn: 5,
	};
}

describe('PositronMarkerService', () => {
	let service: PositronMarkerService;
	const resource = URI.parse('vscode-notebook-cell:///test.qmd#cell0');
	const otherResource = URI.file('/other.py');

	beforeEach(() => {
		service = new PositronMarkerService();
	});

	afterEach(() => {
		service.dispose();
	});

	it('hides an excluded resource from reads, by resource, by owner, and globally', () => {
		service.changeOne('owner', resource, [markerData('hidden')]);
		service.changeOne('owner', otherResource, [markerData('visible')]);

		const exclusion = service.installResourceExclusion(resource);
		expect({
			byResource: service.read({ resource }).map(m => m.message),
			byOwner: service.read({ owner: 'owner' }).map(m => m.message),
			all: service.read().map(m => m.message),
		}).toEqual({
			byResource: [],
			byOwner: ['visible'],
			all: ['visible'],
		});
		exclusion.dispose();
	});

	it('still returns excluded markers to ignoreResourceFilters readers (the ext host bridge path)', () => {
		service.changeOne('owner', resource, [markerData('hidden')]);
		const exclusion = service.installResourceExclusion(resource);

		expect(service.read({ resource, ignoreResourceFilters: true }).map(m => m.message)).toEqual(['hidden']);
		exclusion.dispose();
	});

	it('shows no placeholder marker, unlike installResourceFilter', () => {
		service.changeOne('owner', resource, [markerData('hidden')]);
		const exclusion = service.installResourceExclusion(resource);

		// installResourceFilter would surface a "Problems are paused" info
		// marker; an exclusion must leave nothing behind.
		expect(service.read()).toEqual([]);
		exclusion.dispose();
	});

	it('restores visibility when the exclusion is disposed, and is refcounted', () => {
		service.changeOne('owner', resource, [markerData('hidden')]);
		const first = service.installResourceExclusion(resource);
		const second = service.installResourceExclusion(resource);

		first.dispose();
		const whileSecondHeld = service.read({ resource }).length;
		second.dispose();
		second.dispose(); // double-dispose must not over-decrement

		expect({
			whileSecondHeld,
			afterAllDisposed: service.read({ resource }).map(m => m.message),
		}).toEqual({ whileSecondHeld: 0, afterAllDisposed: ['hidden'] });
	});

	it('fires onMarkerChanged for the resource when an exclusion is installed and removed', async () => {
		service.changeOne('owner', resource, [markerData('hidden')]);
		const events: string[][] = [];
		const listener = service.onMarkerChanged(resources => events.push(resources.map(r => r.toString())));

		const exclusion = service.installResourceExclusion(resource);
		await Promise.resolve(); // the emitter fires on a microtask
		exclusion.dispose();
		await Promise.resolve();

		expect(events).toEqual([[resource.toString()], [resource.toString()]]);
		listener.dispose();
	});

	it('excludes the resource from statistics', async () => {
		service.changeOne('owner', resource, [markerData('hidden')]);
		service.changeOne('owner', otherResource, [markerData('visible')]);
		const exclusion = service.installResourceExclusion(resource);
		// Statistics update on the (microtask) marker change events.
		await Promise.resolve();

		const stats = service.getStatistics();
		expect(stats.errors).toBe(1);
		exclusion.dispose();
	});
});
