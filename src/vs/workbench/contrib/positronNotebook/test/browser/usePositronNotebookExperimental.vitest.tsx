/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act } from '@testing-library/react';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { POSITRON_NOTEBOOK_EXPERIMENTAL } from '../../browser/ContextKeysManager.js';
import { usePositronNotebookExperimental } from '../../browser/usePositronNotebookExperimental.js';

function Harness({ onValue }: { onValue: (v: boolean) => void }) {
	const enabled = usePositronNotebookExperimental();
	onValue(enabled);
	return null;
}

describe('usePositronNotebookExperimental', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function bindKey() {
		// Replace the default MockContextKeyService (which doesn't fire change events)
		// with a real ContextKeyService so the hook can react to updates.
		const realService = ctx.disposables.add(ctx.instantiationService.createInstance(ContextKeyService));
		ctx.instantiationService.stub(IContextKeyService, realService);
		return POSITRON_NOTEBOOK_EXPERIMENTAL.bindTo(realService);
	}

	it('returns false when the context key has its default value', () => {
		bindKey();
		const captured: boolean[] = [];
		rtl.render(<Harness onValue={v => captured.push(v)} />);
		expect(captured.at(-1)).toBe(false);
	});

	it('returns true when the context key is set to true', () => {
		const key = bindKey();
		key.set(true);
		const captured: boolean[] = [];
		rtl.render(<Harness onValue={v => captured.push(v)} />);
		expect(captured.at(-1)).toBe(true);
	});

	it('re-renders when the context key flips', () => {
		const key = bindKey();
		const captured: boolean[] = [];
		rtl.render(<Harness onValue={v => captured.push(v)} />);
		expect(captured.at(-1)).toBe(false);

		act(() => key.set(true));
		expect(captured.at(-1)).toBe(true);

		act(() => key.set(false));
		expect(captured.at(-1)).toBe(false);
	});
});
