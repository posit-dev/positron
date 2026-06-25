/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IRuntimeMissingPackage } from '../../../services/runtimeSession/common/runtimeSessionService.js';

export const IMissingPackagesService = createDecorator<IMissingPackagesService>('missingPackagesService');

/**
 * A group of missing packages that belong to a single session, so a UI surface
 * can install them against the right runtime.
 */
export interface IMissingPackagesGroup {
	/** The session that owns these packages (and that can install them). */
	readonly sessionId: string;

	/** The language of the session, for display/grouping. */
	readonly languageId: string;

	/** The referenced-but-not-installed, installable packages. */
	readonly packages: ReadonlyArray<IRuntimeMissingPackage>;
}

/**
 * The result of analyzing a resource for missing packages. For multi-language
 * documents (e.g. quarto), there is one group per language/session.
 */
export interface IMissingPackagesResult {
	/** The resource that was analyzed. */
	readonly resource: URI;

	/** Per-language/session groupings. */
	readonly groups: ReadonlyArray<IMissingPackagesGroup>;

	/** The total number of missing packages across all groups. */
	readonly total: number;
}

/**
 * A frontend service that discovers which referenced packages are missing (and
 * installable) for a given resource, caches the result per session + content,
 * and installs packages by reusing the runtime's package manager.
 *
 * Designed so callers never block a user gesture: `getCached` is synchronous and
 * never triggers work, while `ensure` computes asynchronously and dedupes
 * in-flight requests.
 */
export interface IMissingPackagesService {
	readonly _serviceBrand: undefined;

	/**
	 * Returns the cached result for a resource, or undefined if it has not been
	 * computed yet. Never triggers work; safe to call on a hot path.
	 */
	getCached(resource: URI): IMissingPackagesResult | undefined;

	/**
	 * Computes (or returns the cached) missing-packages result for a resource.
	 * Safe to call repeatedly; in-flight computations are deduped by cache key.
	 */
	ensure(resource: URI, token?: CancellationToken): Promise<IMissingPackagesResult>;

	/**
	 * Installs the given group's packages against its session. Resolves when the
	 * install completes (or rejects if it fails).
	 */
	install(group: IMissingPackagesGroup, token?: CancellationToken): Promise<void>;

	/**
	 * Fired when the cached result for a resource may have changed (packages
	 * installed/removed, session lifecycle, or content change). UI surfaces
	 * should re-read via `getCached` / `ensure`.
	 */
	readonly onDidChangeMissingPackages: Event<URI>;
}
