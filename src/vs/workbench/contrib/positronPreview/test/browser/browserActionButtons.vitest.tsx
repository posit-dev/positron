/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { BrowserActionButtons } from '../../browser/components/browserActionButtons.js';
import { POSITRON_VIEWER_IS_INTEGRATED_BROWSER } from '../../browser/positronPreviewActions.js';
import { IPreviewSurface } from '../../browser/previewSurface.js';
import { PreviewWebview } from '../../browser/previewWebview.js';
import { POSIT_HAS_CHAT_MODELS_KEY } from '../../../positronAssistant/browser/positAssistantChat.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';

describe('BrowserActionButtons', () => {
	const executeCommand = vi.fn(async () => undefined);
	// A real context key service, which evaluates rules and reads config.* keys from settings.
	const contextKeyService = new ContextKeyService(new TestConfigurationService({ ai: { enabled: true } }));
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand })
		.stub(IContextKeyService, contextKeyService)
		.build();

	afterAll(() => contextKeyService.dispose());
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function preview(kind: 'webview' | 'browser'): PreviewWebview {
		return stubInterface<PreviewWebview>({ surface: stubInterface<IPreviewSurface>({ kind }) });
	}

	it('shows nothing for a webview', () => {
		rtl.render(<BrowserActionButtons preview={preview('webview')} />);

		expect(screen.queryByRole('button', { name: 'Toggle Developer Tools' })).not.toBeInTheDocument();
	});

	it('opens the developer tools, and offers Posit Assistant only once it has a chat model', async () => {
		POSITRON_VIEWER_IS_INTEGRATED_BROWSER.bindTo(contextKeyService).set(true);
		const hasChatModels = contextKeyService.createKey<boolean>(POSIT_HAS_CHAT_MODELS_KEY, false);
		rtl.render(<BrowserActionButtons preview={preview('browser')} />);
		const withoutModel = screen.queryByRole('button', { name: 'Add to Posit Assistant' });

		await userEvent.setup().click(screen.getByRole('button', { name: 'Toggle Developer Tools' }));
		act(() => hasChatModels.set(true));

		expect(withoutModel).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Add to Posit Assistant' })).toBeInTheDocument();
		expect(executeCommand).toHaveBeenCalledWith('workbench.action.positronPreview.toggleDevTools');
	});
});
