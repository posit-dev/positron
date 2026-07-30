/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ProviderList } from '../../browser/components/providerList.js';
import { IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';

function source(overrides: Partial<IPositronLanguageModelSource> & { id: string; displayName?: string }): IPositronLanguageModelSource {
	const { id, displayName, ...rest } = overrides;
	return {
		type: PositronLanguageModelType.Chat,
		provider: { id, displayName: displayName ?? id, settingName: id },
		supportedOptions: [],
		defaults: {},
		...rest,
	} satisfies IPositronLanguageModelSource;
}

// Only source in the model-providers section, so there is exactly one
// "Connect" button and getByRole('button', { name: /connect/i }) is unambiguous.
const sourcesWithPositAi: IPositronLanguageModelSource[] = [
	source({ id: 'posit-ai', displayName: 'Posit AI', supportedOptions: ['oauth'], signedIn: false }),
];

const availableAnthropic: IPositronLanguageModelSource[] = [
	source({ id: 'anthropic-api', displayName: 'Anthropic', supportedOptions: ['apiKey'], signedIn: false }),
];

const connectedAnthropic: IPositronLanguageModelSource[] = [
	source({ id: 'anthropic-api', displayName: 'Anthropic', supportedOptions: ['apiKey'], signedIn: true, status: 'ok' }),
];

describe('ProviderList', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('renders a heading per non-empty section', () => {
		rtl.render(<ProviderList sources={[
			source({ id: 'conn', displayName: 'Connected One', signedIn: true, status: 'ok' }),
			source({ id: 'avail', displayName: 'Available One', signedIn: false }),
		]} onAddCustomProvider={vi.fn()} onSelectProvider={vi.fn()} />);
		expect(screen.getByText('Connected Providers')).toBeInTheDocument();
		expect(screen.getByText('Model Providers')).toBeInTheDocument();
	});

	it('does not render empty built-in section headings', () => {
		rtl.render(<ProviderList sources={[source({ id: 'avail', signedIn: false })]} onAddCustomProvider={vi.fn()} onSelectProvider={vi.fn()} />);
		expect(screen.queryByText('Connected Providers')).not.toBeInTheDocument();
		expect(screen.queryByText('Needs Attention')).not.toBeInTheDocument();
	});

	it('always renders the Custom Provider section with an add button', () => {
		rtl.render(<ProviderList sources={[source({ id: 'avail', signedIn: false })]} onAddCustomProvider={vi.fn()} onSelectProvider={vi.fn()} />);
		expect(screen.getByText('Custom Provider')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Add custom provider/ })).toBeInTheDocument();
	});

	it('shows the built-in description for a known provider', () => {
		rtl.render(<ProviderList sources={[source({ id: 'anthropic-api', displayName: 'Anthropic', signedIn: false })]} onAddCustomProvider={vi.fn()} onSelectProvider={vi.fn()} />);
		expect(screen.getByText('Access Claude models directly via Anthropic API')).toBeInTheDocument();
	});

	it('reports the source when Connect is clicked on Posit AI', async () => {
		const onSelectProvider = vi.fn();
		const user = userEvent.setup();
		rtl.render(<ProviderList sources={sourcesWithPositAi} onAddCustomProvider={vi.fn()} onSelectProvider={onSelectProvider} />);
		await user.click(screen.getByRole('button', { name: /connect/i }));
		expect(onSelectProvider).toHaveBeenCalledWith(
			expect.objectContaining({ provider: expect.objectContaining({ id: 'posit-ai' }) }),
		);
	});

	it('reports the source when Connect is clicked on Anthropic', async () => {
		const onSelectProvider = vi.fn();
		const user = userEvent.setup();
		rtl.render(<ProviderList sources={availableAnthropic} onAddCustomProvider={vi.fn()} onSelectProvider={onSelectProvider} />);
		await user.click(screen.getByRole('button', { name: /connect/i }));
		expect(onSelectProvider).toHaveBeenCalledWith(
			expect.objectContaining({ provider: expect.objectContaining({ id: 'anthropic-api' }) }),
		);
	});

	it('reports the source when Edit is clicked on connected Anthropic', async () => {
		const onSelectProvider = vi.fn();
		const user = userEvent.setup();
		rtl.render(<ProviderList sources={connectedAnthropic} onAddCustomProvider={vi.fn()} onSelectProvider={onSelectProvider} />);
		await user.click(screen.getByRole('button', { name: /edit/i }));
		expect(onSelectProvider).toHaveBeenCalledWith(
			expect.objectContaining({ provider: expect.objectContaining({ id: 'anthropic-api' }) }),
		);
	});

	it('reports the source for a not-yet-supported provider row too (routing is the modal\'s job)', async () => {
		const onSelectProvider = vi.fn();
		const user = userEvent.setup();
		rtl.render(<ProviderList sources={[source({ id: 'amazon-bedrock', displayName: 'AWS', supportedOptions: ['toolCalls'], signedIn: false })]} onAddCustomProvider={vi.fn()} onSelectProvider={onSelectProvider} />);
		await user.click(screen.getByRole('button', { name: /connect/i }));
		expect(onSelectProvider).toHaveBeenCalledWith(
			expect.objectContaining({ provider: expect.objectContaining({ id: 'amazon-bedrock' }) }),
		);
	});

	it('reports the source when Fix Connection is clicked on a needs-attention provider', async () => {
		const onSelectProvider = vi.fn();
		const user = userEvent.setup();
		rtl.render(<ProviderList sources={[source({ id: 'anthropic-api', displayName: 'Anthropic', signedIn: true, status: 'error', statusMessage: 'Bad base URL' })]} onAddCustomProvider={vi.fn()} onSelectProvider={onSelectProvider} />);
		await user.click(screen.getByRole('button', { name: /fix connection/i }));
		expect(onSelectProvider).toHaveBeenCalledWith(
			expect.objectContaining({ provider: expect.objectContaining({ id: 'anthropic-api' }) }),
		);
	});

	it('invokes onAddCustomProvider when the Add custom provider button is clicked', async () => {
		const onAddCustomProvider = vi.fn();
		const user = userEvent.setup();
		rtl.render(<ProviderList sources={[source({ id: 'avail', signedIn: false })]} onAddCustomProvider={onAddCustomProvider} onSelectProvider={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: /add custom provider/i }));
		expect(onAddCustomProvider).toHaveBeenCalled();
	});
});
