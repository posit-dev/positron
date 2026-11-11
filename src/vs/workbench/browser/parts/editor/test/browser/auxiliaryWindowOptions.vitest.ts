/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import { createLightTestContainer } from '../../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { TestEditorInput } from '../../../../../test/browser/workbenchTestServices.js';
import { getAuxiliaryWindowOptionsForEditors } from '../../editor.js';

describe('getAuxiliaryWindowOptionsForEditors', () => {
	const ctx = createLightTestContainer().build();

	// TestEditorInput uses its type id as its editor id.
	const editorOfType = (typeId: string) =>
		ctx.disposables.add(new TestEditorInput(URI.file(`/workspace/${typeId}`), typeId));
	const sourceWindow = stubInterface<Window>({ outerWidth: 1400, outerHeight: 900 });

	it('opens Posit Assistant tabs in the dedicated window, sized to the source window', () => {
		expect(getAuxiliaryWindowOptionsForEditors([editorOfType('mainThreadWebview-posit-assistant')], sourceWindow)).toEqual({
			compact: true,
			nativeTitlebar: true,
			bounds: { width: 1400, height: 900 },
		});
	});

	it('keeps a normal window for other webviews, including Canvas', () => {
		expect(getAuxiliaryWindowOptionsForEditors([editorOfType('mainThreadWebview-posit-assistant.canvas')], sourceWindow)).toBeUndefined();
		expect(getAuxiliaryWindowOptionsForEditors([editorOfType('mainThreadWebview-markdown.preview')], sourceWindow)).toBeUndefined();
	});
});
