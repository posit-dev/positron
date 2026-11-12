/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { OpenCounterEditorAction } from '../../browser/counterActions.js';
import { CounterEditorInput } from '../../browser/counterEditorInput.js';

describe('OpenCounterEditorAction', () => {
	const openEditor = vi.fn();
	const ctx = createLightTestContainer()
		// openEditor is overloaded, which a single mock signature cannot satisfy.
		.stub(IEditorService, stubInterface<IEditorService>({ openEditor: openEditor as IEditorService['openEditor'] }))
		.build();

	it('reveals an already-open Counter editor instead of opening another', async () => {
		ctx.instantiationService.stub(IInstantiationService, ctx.instantiationService);
		await ctx.instantiationService.invokeFunction(accessor => new OpenCounterEditorAction().run(accessor));
		const [input, options] = openEditor.mock.calls[0];
		ctx.disposables.add(input as CounterEditorInput);
		expect(input).toBeInstanceOf(CounterEditorInput);
		expect(options).toEqual({ pinned: true, revealIfOpened: true });
	});
});
