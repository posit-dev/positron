/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubGridLayoutWithSize } from '../../../../../test/vitest/stubGridLayout.js';
import { ObjectExplorerClientInstance } from '../../../../services/languageRuntime/common/languageRuntimeObjectExplorerClient.js';
import { JsonObjectExplorerBackend } from '../../../../services/positronObjectExplorer/common/jsonObjectExplorerBackend.js';
import { PositronObjectExplorerInstance } from '../../../../services/positronObjectExplorer/browser/positronObjectExplorerInstance.js';
import { IPositronObjectExplorerInstance } from '../../../../services/positronObjectExplorer/browser/interfaces/positronObjectExplorerInstance.js';
import { IPositronObjectExplorerService } from '../../../../services/positronObjectExplorer/browser/interfaces/positronObjectExplorerService.js';
import { InlineObjectExplorer } from '../../inlineObjectExplorer.js';

describe('InlineObjectExplorer', () => {
	let instance: IPositronObjectExplorerInstance | undefined;
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronObjectExplorerService, { getInstanceAsync: async () => instance })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let restoreLayout: () => void;
	beforeEach(() => {
		restoreLayout = stubGridLayoutWithSize(600, 300);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		restoreLayout();
	});

	function createInstance() {
		const backend = new JsonObjectExplorerBackend('json:test', 'config', { a: 1, b: { c: 2 } });
		const client = new ObjectExplorerClientInstance(backend);
		instance = ctx.disposables.add(ctx.instantiationService.createInstance(PositronObjectExplorerInstance, 'JSON', client, true, undefined, undefined));
		return { backend };
	}

	it('shows the object and opens it in a full object explorer', async () => {
		const { backend } = createInstance();
		const openObjectExplorer = vi.fn(async () => 'new-comm');
		Object.assign(backend, { openObjectExplorer });
		const user = userEvent.setup();

		rtl.render(<InlineObjectExplorer commId='json:test' title='config' />);

		expect(await screen.findByText('b')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Open in Object Explorer' }));
		expect(openObjectExplorer).toHaveBeenCalledTimes(1);
	});

	it('falls back when the object explorer is not found', async () => {
		instance = undefined;
		const onFallback = vi.fn();

		rtl.render(<InlineObjectExplorer commId='missing' title='config' onFallback={onFallback} />);

		await waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1));
	});
});
