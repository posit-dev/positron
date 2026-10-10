/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PositronObjectExplorerUri } from '../../../../services/positronObjectExplorer/common/positronObjectExplorerUri.js';
import { IPositronObjectExplorerService } from '../../../../services/positronObjectExplorer/browser/interfaces/positronObjectExplorerService.js';
import { PositronObjectExplorerEditorInput } from '../../browser/positronObjectExplorerEditorInput.js';

describe('PositronObjectExplorerEditorInput', () => {
	const commId = '12345678-1234-1234-1234-1234567890ab';

	function makeInput() {
		const closeInstance = vi.fn();
		const input = new PositronObjectExplorerEditorInput(
			PositronObjectExplorerUri.generate(commId),
			stubInterface<IPositronObjectExplorerService>({ closeInstance })
		);
		return { input, closeInstance };
	}

	it('releases its instance when the editor closes', () => {
		const { input, closeInstance } = makeInput();

		input.dispose();

		expect(closeInstance).toHaveBeenCalledWith(commId);
	});

	it('names the tab after the object, truncating long titles', () => {
		const { input } = makeInput();

		input.setTitle('model');
		const short = input.getName();
		input.setTitle('a'.repeat(40));
		const long = input.getName();
		input.dispose();

		expect([short, long]).toEqual(['Object: model', `Object: ${'a'.repeat(27)}...`]);
	});
});
