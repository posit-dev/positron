/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PositronReactServices } from '../../../../../base/browser/positronReactServices.tsx';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.ts';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.tsx';
import { PositronNotebookComponent } from '../../browser/PositronNotebookComponent.tsx';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.ts';

describe('PositronNotebookComponent', () => {
	const ctx = createTestContainer().withNotebookEditorServices().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		// TableSummaryDataGridInstance reads PositronReactServices.services
		// (static singleton) in its constructor. Bridge the builder-configured
		// DI container to the singleton so the services stubbed above flow
		// through to the instance under test.
		PositronReactServices.services = ctx.reactServices;
	});

	afterEach(() => {
		// Clear the singleton bridged in beforeEach so no disposed reactServices
		// instance outlives the suite.
		PositronReactServices.services = undefined!;
	});

	function renderNotebook() {
		const notebook = createTestPositronNotebookInstance(
			[],
			ctx,
		);

		const { container } = rtl.render(
			<PositronNotebookComponent
				notebookInstance={notebook}
				onReload={() => { /* no-op */ }}
			/>
		);

		return { container };
	}

	it('renders', () => {
		renderNotebook();
	});
});
