/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { keepAuxiliaryEditorParts, shouldKeepAuxiliaryEditorParts } from '../../browser/positronEditorPartsLayout.js';

describe('keepAuxiliaryEditorParts', () => {
	it('holds until every holder releases', () => {
		expect(shouldKeepAuxiliaryEditorParts()).toBe(false);
		const first = keepAuxiliaryEditorParts();
		const second = keepAuxiliaryEditorParts();
		first.dispose();
		expect(shouldKeepAuxiliaryEditorParts()).toBe(true);
		second.dispose();
		expect(shouldKeepAuxiliaryEditorParts()).toBe(false);
	});
});
