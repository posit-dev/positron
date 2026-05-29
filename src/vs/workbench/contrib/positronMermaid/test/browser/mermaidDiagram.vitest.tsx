/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { IThemeService, IColorTheme } from '../../../../../platform/theme/common/themeService.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IMermaidRenderService } from '../../browser/mermaidRenderService.js';
import { MermaidDiagram } from '../../browser/mermaidDiagramComponent.js';

vi.mock('../../../../../base/browser/trustedTypes.js', () => ({
	createTrustedTypesPolicy: () => ({ createHTML: (value: string) => value }),
}));

describe('MermaidDiagram', () => {
	const onDidColorThemeChange = new Emitter<IColorTheme>();
	const mockRender = vi.fn().mockResolvedValue('<svg><text>rendered</text></svg>');
	let currentThemeType = 'light';

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IMermaidRenderService, { render: mockRender })
		.stub(IThemeService, {
			getColorTheme: () => ({ type: currentThemeType }),
			onDidColorThemeChange: onDidColorThemeChange.event,
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		mockRender.mockClear();
		mockRender.mockResolvedValue('<svg><text>rendered</text></svg>');
		currentThemeType = 'light';
	});

	it('shows loading state initially', () => {
		rtl.render(<MermaidDiagram source='graph TD; A-->B' />);
		expect(screen.getByText('Rendering diagram...')).toBeInTheDocument();
	});

	it('displays rendered SVG on success', async () => {
		rtl.render(<MermaidDiagram source='graph TD; A-->B' />);
		expect(await screen.findByText('rendered')).toBeInTheDocument();
	});

	it('shows error message on render failure', async () => {
		mockRender.mockRejectedValue(new Error('invalid syntax'));
		rtl.render(<MermaidDiagram source='bad' />);
		expect(await screen.findByText(/invalid syntax/)).toBeInTheDocument();
	});

	it('fires onDoubleClick when container is double-clicked', async () => {
		const onDoubleClick = vi.fn();
		rtl.render(<MermaidDiagram source='graph TD; A-->B' onDoubleClick={onDoubleClick} />);
		const svgElement = await screen.findByText('rendered');
		const user = userEvent.setup();
		await user.dblClick(svgElement.closest('.mermaid-diagram-container')!);
		expect(onDoubleClick).toHaveBeenCalledOnce();
	});

	it('re-renders when theme changes', async () => {
		rtl.render(<MermaidDiagram source='graph TD; A-->B' />);
		expect(await screen.findByText('rendered')).toBeInTheDocument();
		expect(mockRender).toHaveBeenCalledWith('graph TD; A-->B', 'default');

		mockRender.mockResolvedValue('<svg><text>dark-render</text></svg>');
		currentThemeType = 'dark';
		act(() => {
			onDidColorThemeChange.fire(stubInterface<IColorTheme>());
		});
		await waitFor(() => {
			expect(mockRender).toHaveBeenCalledWith('graph TD; A-->B', 'dark');
		});
		expect(await screen.findByText('dark-render')).toBeInTheDocument();
	});

	it('discards stale render when source changes before completion', async () => {
		const firstDeferred = new DeferredPromise<string>();
		mockRender.mockReturnValueOnce(firstDeferred.p);
		const { rerender } = rtl.render(<MermaidDiagram source='graph A' />);
		expect(screen.getByText('Rendering diagram...')).toBeInTheDocument();

		mockRender.mockResolvedValue('<svg><text>second</text></svg>');
		rerender(<MermaidDiagram source='graph B' />);

		// Resolve the stale first render -- it should be discarded
		firstDeferred.complete('<svg><text>first</text></svg>');
		expect(await screen.findByText('second')).toBeInTheDocument();
		expect(screen.queryByText('first')).not.toBeInTheDocument();
	});

	it('has an accessible label on the rendered diagram', async () => {
		rtl.render(<MermaidDiagram source='graph TD; A-->B' />);
		const diagram = await screen.findByRole('img');
		expect(diagram).toHaveAttribute('aria-label', 'Mermaid diagram');
	});
});
