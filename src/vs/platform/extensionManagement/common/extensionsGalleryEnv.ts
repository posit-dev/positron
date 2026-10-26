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
 * Returns undefined if the value is not valid JSON or lacks a serviceUrl
 * string, so a malformed env var is ignored rather than crashing startup or
 * silently disabling the marketplace. The caller should fall back to the
 * default product gallery when undefined is returned.
 *
 * An explicit empty serviceUrl (`{"serviceUrl": ""}`) is valid and means the
 * marketplace is disabled; see isExtensionsGalleryDisabled.
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
	let parsed: unknown;
	try {
		parsed = JSON.parse(envValue);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		warn(`Ignoring EXTENSIONS_GALLERY env var: not valid JSON (${message}).`);
		return undefined;
	}
	// Valid JSON can still be an unusable gallery config: {}, [], 42, or an object
	// with a misspelled key like "serviceUrls". Require a serviceUrl string so a
	// malformed value falls back to the default gallery instead of silently
	// disabling the marketplace. The other fields are checked later in the
	// gallery manifest service and can be logged there, but serviceUrl is
	// essential to know up front whether this config is usable at all.
	//
	// An empty serviceUrl string is accepted on purpose. Posit Workbench sets
	// EXTENSIONS_GALLERY={"serviceUrl": ""} to disable the marketplace for users
	// who cannot write to a global extensions directory (ServerJobLauncher.cpp in
	// rstudio-pro). Rejecting it lets the gallerySource setting turn the
	// marketplace back on; see https://github.com/posit-dev/positron/issues/16199.
	const serviceUrl = (parsed as { serviceUrl?: unknown } | null)?.serviceUrl;
	if (typeof serviceUrl !== 'string') {
		warn(`Ignoring EXTENSIONS_GALLERY env var: missing required "serviceUrl" string.`);
		return undefined;
	}
	return parsed as T;
}

/**
 * Whether a parsed EXTENSIONS_GALLERY config disables the marketplace. An
 * explicit empty serviceUrl means "no gallery", matching upstream VS Code, where
 * an empty product serviceUrl leaves the gallery unavailable.
 */
export function isExtensionsGalleryDisabled(config: { readonly serviceUrl: string }): boolean {
	return config.serviceUrl === '';
}
