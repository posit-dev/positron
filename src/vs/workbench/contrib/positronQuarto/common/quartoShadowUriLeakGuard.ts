/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../base/common/network.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { isQuartoOrRmdFile } from './positronQuartoConfig.js';

/**
 * Post-processing guard for the Quarto shadow bridge providers: no
 * `vscode-notebook-cell:` URI of a shadow notebook may ever leak back into a
 * user-facing result. Every location, edit, or link a bridge provider returns
 * must target either the `.qmd` document (translated) or an unrelated real
 * file.
 *
 * The guard is a deep scan rather than per-provider field knowledge, so a
 * translation that misses a field on a complex result type fails closed
 * (result dropped, error logged) instead of surfacing a URI the user cannot
 * meaningfully open.
 */

/**
 * Property keys excluded from the scan. Command payloads round-trip to the
 * extension that produced them, where cell URIs are the native coordinate
 * space (e.g. an LSP completion item's auto-import command carries the cell
 * document URI); they are never opened or edited by the workbench directly.
 */
const SKIPPED_KEYS = new Set(['command']);

/** Upper bound on scanned nodes, so a pathological result can't stall a request. */
const MAX_SCANNED_NODES = 10_000;

/**
 * Whether a URI is a shadow notebook cell URI: the `vscode-notebook-cell`
 * scheme over a Quarto/R Markdown path. Cell URIs share their notebook's
 * path, and shadow notebooks are the only notebooks whose resource is a
 * `.qmd`/`.rmd` file, so the path suffix identifies them. Cell URIs of real
 * notebooks (e.g. `.ipynb`) are legitimate user-facing locations and pass.
 */
export function isShadowCellUri(uri: UriComponents): boolean {
	return uri.scheme === Schemas.vscodeNotebookCell && isQuartoOrRmdFile(uri.path);
}

/** Whether a value is a URI or a plain `UriComponents`-shaped object. */
function isUriShaped(value: object): value is UriComponents {
	return URI.isUri(value)
		|| (typeof (value as UriComponents).scheme === 'string' && typeof (value as UriComponents).path === 'string');
}

/**
 * Deep-scan a provider result for shadow cell URIs, walking arrays, Maps,
 * Sets, and plain object properties (skipping {@link SKIPPED_KEYS}).
 * @returns The first leaked shadow cell URI found, or undefined. Best-effort:
 * gives up (returning undefined) after {@link MAX_SCANNED_NODES} nodes.
 */
export function findShadowCellUriLeak(value: unknown): UriComponents | undefined {
	const seen = new Set<object>();
	let budget = MAX_SCANNED_NODES;

	const visit = (node: unknown): UriComponents | undefined => {
		if (budget-- <= 0 || node === null || typeof node !== 'object' || seen.has(node)) {
			return undefined;
		}
		seen.add(node);

		if (isUriShaped(node)) {
			return isShadowCellUri(node) ? node : undefined;
		}
		if (Array.isArray(node)) {
			for (const item of node) {
				const leak = visit(item);
				if (leak) {
					return leak;
				}
			}
			return undefined;
		}
		if (node instanceof Map) {
			for (const [key, item] of node) {
				const leak = visit(key) ?? visit(item);
				if (leak) {
					return leak;
				}
			}
			return undefined;
		}
		if (node instanceof Set) {
			for (const item of node) {
				const leak = visit(item);
				if (leak) {
					return leak;
				}
			}
			return undefined;
		}
		for (const [key, item] of Object.entries(node)) {
			if (SKIPPED_KEYS.has(key)) {
				continue;
			}
			const leak = visit(item);
			if (leak) {
				return leak;
			}
		}
		return undefined;
	};

	return visit(value);
}

/**
 * Fail-closed wrapper around {@link findShadowCellUriLeak} for bridge
 * providers: apply to every result just before returning it.
 * @returns The result unchanged when clean, or undefined (with an error
 * logged) when a shadow cell URI leaked through translation.
 */
export function guardAgainstShadowCellUriLeaks<T>(feature: string, result: T, logService: ILogService): T | undefined {
	const leak = findShadowCellUriLeak(result);
	if (leak) {
		logService.error(`[QuartoShadowBridge] Dropping ${feature} result: shadow cell URI leaked through translation: ${URI.isUri(leak) ? leak.toString() : JSON.stringify(leak)}`);
		return undefined;
	}
	return result;
}
