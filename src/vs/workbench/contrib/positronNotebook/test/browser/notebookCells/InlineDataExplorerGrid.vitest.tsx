/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { InlineDataExplorerGrid } from '../../../browser/notebookCells/InlineDataExplorer.js';

describe('InlineDataExplorerGrid', () => {
	const configurationService = new TestConfigurationService({ editor: { fontSize: 20 } });
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IConfigurationService, configurationService)
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderGrid() {
		rtl.render(
			<InlineDataExplorerGrid>
				<span>grid</span>
			</InlineDataExplorerGrid>
		);
		return screen.getByText('grid').parentElement!;
	}

	it('applies the editor font size, so the grid headers inherit it', () => {
		expect(renderGrid()).toHaveStyle({ fontSize: '20px' });
	});

	it('updates the font size when the editor font size changes', () => {
		const wrapper = renderGrid();

		act(() => {
			configurationService.setUserConfiguration('editor', { fontSize: 28 });
			configurationService.onDidChangeConfigurationEmitter.fire(stubInterface<IConfigurationChangeEvent>({
				affectsConfiguration: (section: string) => section === 'editor',
				affectedKeys: new Set(['editor.fontSize']),
			}));
		});

		expect(wrapper).toHaveStyle({ fontSize: '28px' });
	});
});
