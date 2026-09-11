/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { pickConfiguredDownloadUrlTemplate } from './serverDownloadUrl';

const LEGACY_URL = 'https://example.test/legacy/positron-reh-${os}-${arch}-${version}.tar.gz';
const UNIFIED_URL = 'https://example.test/unified/positron-reh-${os}-${arch}-${version}.tar.gz';

/**
 * What an untouched setting looks like. `inspect()` reports no scope values at all, and the
 * shipped default arrives in a `defaultValue` field this code deliberately does not read.
 */
const UNSET = {};

describe('pickConfiguredDownloadUrlTemplate', () => {
	describe('when the user set the deprecated setting', () => {
		it('returns the deprecated value even when the unified setting is also set', () => {
			const result = pickConfiguredDownloadUrlTemplate(
				{ globalValue: LEGACY_URL }, { globalValue: UNIFIED_URL });
			expect(result).toBe(LEGACY_URL);
		});

		it('prefers the folder scope over the workspace and global scopes', () => {
			const result = pickConfiguredDownloadUrlTemplate({
				globalValue: 'https://example.test/global.tar.gz',
				workspaceValue: 'https://example.test/workspace.tar.gz',
				workspaceFolderValue: 'https://example.test/folder.tar.gz'
			}, UNSET);
			expect(result).toBe('https://example.test/folder.tar.gz');
		});

		it('prefers the workspace scope over the global scope', () => {
			const result = pickConfiguredDownloadUrlTemplate({
				globalValue: 'https://example.test/global.tar.gz',
				workspaceValue: 'https://example.test/workspace.tar.gz'
			}, UNSET);
			expect(result).toBe('https://example.test/workspace.tar.gz');
		});

		it('falls through an empty deprecated value to the unified setting', () => {
			const result = pickConfiguredDownloadUrlTemplate(
				{ globalValue: '' }, { globalValue: UNIFIED_URL });
			expect(result).toBe(UNIFIED_URL);
		});
	});

	describe('when the user set only the unified setting', () => {
		it('returns the unified value', () => {
			const result = pickConfiguredDownloadUrlTemplate(UNSET, { globalValue: UNIFIED_URL });
			expect(result).toBe(UNIFIED_URL);
		});
	});

	describe('when the user set neither setting', () => {
		// The reason both settings are read with `inspect()` rather than `get()`. The
		// deprecated setting ships a non-empty default, so `get()` would report the CDN URL
		// here and the caller would never reach its product.json fallback.
		it('returns undefined, so the caller falls back to product.json', () => {
			const result = pickConfiguredDownloadUrlTemplate(UNSET, UNSET);
			expect(result).toBeUndefined();
		});

		it('returns undefined when neither setting reports anything at all', () => {
			const result = pickConfiguredDownloadUrlTemplate(undefined, undefined);
			expect(result).toBeUndefined();
		});

		it('returns undefined when the unified setting holds its empty default', () => {
			const result = pickConfiguredDownloadUrlTemplate(UNSET, { globalValue: '' });
			expect(result).toBeUndefined();
		});
	});
});
