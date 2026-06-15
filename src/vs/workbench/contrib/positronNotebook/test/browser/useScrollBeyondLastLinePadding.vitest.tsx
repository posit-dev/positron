/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { observableValue } from '../../../../../base/common/observable.js';
import { ISize } from '../../../../../base/browser/positronReactRenderer.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { useScrollBeyondLastLinePadding } from '../../browser/useScrollBeyondLastLinePadding.js';

function TestComponent({ configurationService, size }: {
	configurationService: IConfigurationService;
	size: ReturnType<typeof observableValue<ISize>>;
}) {
	const padding = useScrollBeyondLastLinePadding(configurationService, size);
	return <div data-testid='container' style={{ paddingBottom: padding }} />;
}

describe('useScrollBeyondLastLinePadding', () => {
	const rtl = setupRTLRenderer();

	it('returns undefined when scrollBeyondLastLine is false', () => {
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration('editor.scrollBeyondLastLine', false);
		const size = observableValue<ISize>('size', { width: 800, height: 600 });

		rtl.render(<TestComponent configurationService={configurationService} size={size} />);

		expect(screen.getByTestId('container')).not.toHaveAttribute('style');
	});

	it('returns height minus 50 when scrollBeyondLastLine is true', () => {
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration('editor.scrollBeyondLastLine', true);
		const size = observableValue<ISize>('size', { width: 800, height: 600 });

		rtl.render(<TestComponent configurationService={configurationService} size={size} />);

		expect(screen.getByTestId('container')).toHaveStyle({ paddingBottom: '550px' });
	});

	it('clamps to 0 when height is less than 50', () => {
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration('editor.scrollBeyondLastLine', true);
		const size = observableValue<ISize>('size', { width: 800, height: 30 });

		rtl.render(<TestComponent configurationService={configurationService} size={size} />);

		expect(screen.getByTestId('container')).toHaveStyle({ paddingBottom: '0px' });
	});

	it('updates when scrollBeyondLastLine changes from false to true', async () => {
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration('editor.scrollBeyondLastLine', false);
		const size = observableValue<ISize>('size', { width: 800, height: 600 });

		rtl.render(<TestComponent configurationService={configurationService} size={size} />);
		expect(screen.getByTestId('container')).not.toHaveAttribute('style');

		await act(async () => {
			configurationService.setUserConfiguration('editor.scrollBeyondLastLine', true);
			configurationService.onDidChangeConfigurationEmitter.fire(
				stubInterface<IConfigurationChangeEvent>({
					affectsConfiguration: (key: string) => key === 'editor.scrollBeyondLastLine',
				})
			);
		});

		expect(screen.getByTestId('container')).toHaveStyle({ paddingBottom: '550px' });
	});

	it('updates when the editor size changes', async () => {
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration('editor.scrollBeyondLastLine', true);
		const size = observableValue<ISize>('size', { width: 800, height: 600 });

		rtl.render(<TestComponent configurationService={configurationService} size={size} />);
		expect(screen.getByTestId('container')).toHaveStyle({ paddingBottom: '550px' });

		await act(async () => {
			size.set({ width: 800, height: 400 }, undefined);
		});

		expect(screen.getByTestId('container')).toHaveStyle({ paddingBottom: '350px' });
	});
});
