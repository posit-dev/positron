/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../base/common/map.js';
import { URI } from '../../../base/common/uri.js';
import { IMarker, IMarkerReadOptions } from './markers.js';
import { MarkerService } from './markerService.js';

/**
 * Positron's marker service: {@link MarkerService} plus per-resource read
 * exclusions ({@link installResourceExclusion}).
 *
 * An excluded resource's markers stay in the service (the data is the source
 * of truth other components read with `ignoreResourceFilters`, e.g. the
 * extension host bridge) but are omitted from regular reads, so they never
 * surface in the Problems pane, problem counts, or marker navigation.
 *
 * This exists for resources whose markers are re-projected elsewhere. The
 * first consumer is the Quarto shadow notebook: language servers publish
 * diagnostics against hidden `vscode-notebook-cell` resources, Positron
 * re-projects them onto the `.qmd` document, and the raw cell entries are
 * excluded so problems don't show twice (once under an unopenable cell URI).
 *
 * Contrast with {@link MarkerService.installResourceFilter}, which REPLACES a
 * resource's markers with an informational "problems are paused" marker; an
 * exclusion hides the resource entirely.
 */
export class PositronMarkerService extends MarkerService {

	/** Reference count of active exclusions per resource. */
	private readonly _excludedResources = new ResourceMap<number>();

	installResourceExclusion(resource: URI): IDisposable {
		const count = this._excludedResources.get(resource) ?? 0;
		this._excludedResources.set(resource, count + 1);
		if (count === 0) {
			// Presentation changed: consumers (Problems pane, stats) must re-read.
			this._onMarkerChanged.fire([resource]);
		}
		let disposed = false;
		return toDisposable(() => {
			if (disposed) {
				return;
			}
			disposed = true;
			const count = this._excludedResources.get(resource) ?? 0;
			if (count <= 1) {
				this._excludedResources.delete(resource);
				this._onMarkerChanged.fire([resource]);
			} else {
				this._excludedResources.set(resource, count - 1);
			}
		});
	}

	override read(filter: IMarkerReadOptions = Object.create(null)): IMarker[] {
		const markers = super.read(filter);
		// `ignoreResourceFilters` bypasses exclusions the same way it bypasses
		// the base class's resource filters: it marks a reader that wants the
		// raw data (the extension host bridge, the re-projection itself).
		if (filter.ignoreResourceFilters || this._excludedResources.size === 0) {
			return markers;
		}
		return markers.filter(marker => !this._excludedResources.has(marker.resource));
	}
}
