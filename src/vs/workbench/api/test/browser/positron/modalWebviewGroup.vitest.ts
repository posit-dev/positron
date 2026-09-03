/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { MODAL_GROUP } from '../../../../services/editor/common/editorService.js';
import { resolveModalWebviewGroup } from '../../../browser/positron/modalWebviewGroup.js';

describe('resolveModalWebviewGroup', () => {
	test('returns MODAL_GROUP when modal is requested', () => {
		expect(resolveModalWebviewGroup({
			modal: true,
			useModalSetting: 'some',
		})).toBe(MODAL_GROUP);
	});

	test('falls through when modal is not requested', () => {
		expect(resolveModalWebviewGroup({
			modal: false,
			useModalSetting: 'some',
		})).toBeUndefined();
	});

	test('falls through when the user disabled modal editors', () => {
		expect(resolveModalWebviewGroup({
			modal: true,
			useModalSetting: 'off',
		})).toBeUndefined();
	});

	test('returns MODAL_GROUP when the setting is unset', () => {
		// The setting defaults to enabled, so an unset value must not be read as
		// an opt-out.
		expect(resolveModalWebviewGroup({
			modal: true,
			useModalSetting: undefined,
		})).toBe(MODAL_GROUP);
	});

	// Regression: an earlier version also required
	// `IEditorGroupsService.activeModalEditorPart` to already exist. That part is
	// created on demand by editorGroupFinder, and is undefined until a window has
	// opened its first modal, so the gate made the first panel open as a tab.
	test('does not require a modal editor part to already exist', () => {
		expect(resolveModalWebviewGroup({
			modal: true,
			useModalSetting: 'all',
		})).toBe(MODAL_GROUP);
	});
});
