/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { shouldRestoreAuxiliaryEditorPart } from '../../positronEditorPartsRestore.js';

describe('shouldRestoreAuxiliaryEditorPart', () => {
	it('does not restore a Canvas window', () => {
		expect(shouldRestoreAuxiliaryEditorPart({ compact: true, lockCompact: true })).toBe(false);
	});

	it('restores other auxiliary windows, compact ones included', () => {
		expect(shouldRestoreAuxiliaryEditorPart({})).toBe(true);
		expect(shouldRestoreAuxiliaryEditorPart({ compact: true })).toBe(true);
		expect(shouldRestoreAuxiliaryEditorPart({ compact: true, lockCompact: false })).toBe(true);
	});
});
