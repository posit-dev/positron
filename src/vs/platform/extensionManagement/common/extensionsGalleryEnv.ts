/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Type-only import: erased at runtime so this module stays a leaf and can be
// safely imported from product.ts (which loads before the extension management
// Registry contributions are wired up). See extensionManagement.ts:719 — that
// file runs Registry side-effects at module load, so any runtime import chain
// from product.ts into it would crash startup.
import type { IProductConfiguration } from '../../../base/common/product.js';

/**
 * Parses the EXTENSIONS_GALLERY env var into an extensions-gallery config.
 * Returns undefined if the value is not valid JSON, so a malformed env var is
 * ignored rather than crashing startup. The caller should fall back to the
 * default product gallery when undefined is returned.
 *
 * Pass `warn` to route the failure message somewhere persistent (e.g. an
 * ILogService). The default writes to console.warn — appropriate for product.ts
 * at module-load time when no logger is wired up yet, but invisible in the log
 * file. Workbench-stage callers should pass `msg => logService.warn(msg)`.
 *
 * The generic parameter lets downstream forks specialize the return type with
 * a wider gallery shape (e.g. one that includes itemUrl/publisherUrl) without
 * this leaf module needing to know about those fields.
 */
export function parseExtensionsGalleryEnv<T = NonNullable<IProductConfiguration['extensionsGallery']>>(
	envValue: string,
	warn: (message: string) => void = msg => console.warn(msg),
): T | undefined {
	try {
		return JSON.parse(envValue) as T;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		warn(`Ignoring EXTENSIONS_GALLERY env var: not valid JSON (${message}).`);
		return undefined;
	}
}
