/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { IObservable, observableValue } from '../../../../../base/common/observable.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { useScrollBeyondLastLinePadding } from '../../browser/useScrollBeyondLastLinePadding.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';

function TestComponent({ height }: {
	height: IObservable<number>;
}) {
	const padding = useScrollBeyondLastLinePadding(height);
	return <div data-testid='container' style={{ paddingBottom: padding }} />;
}

describe('useScrollBeyondLastLinePadding', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderWithHeight(height: ReturnType<typeof observableValue<number>>) {
		return rtl.render(
			<TestComponent height={height} />
		);
	}

	it('returns undefined when scrollBeyondLastLine is false', () => {
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		configurationService.setUserConfiguration('editor.scrollBeyondLastLine', false);
		const height = observableValue<number>('height', 600);

		renderWithHeight(height);

		expect(screen.getByTestId('container')).not.toHaveAttribute('style');
	});

	it('returns height minus 50 when scrollBeyondLastLine is true', () => {
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		configurationService.setUserConfiguration('editor.scrollBeyondLastLine', true);
		const height = observableValue<number>('height', 600);

		renderWithHeight(height);

		expect(screen.getByTestId('container')).toHaveStyle({ paddingBottom: '550px' });
	});

	it('clamps to 0 when height is less than 50', () => {
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		configurationService.setUserConfiguration('editor.scrollBeyondLastLine', true);
		const height = observableValue<number>('height', 30);

		renderWithHeight(height);

		expect(screen.getByTestId('container')).toHaveStyle({ paddingBottom: '0px' });
	});

	it('updates when scrollBeyondLastLine changes from false to true', async () => {
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		configurationService.setUserConfiguration('editor.scrollBeyondLastLine', false);
		const height = observableValue<number>('height', 600);

		renderWithHeight(height);
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

	it('updates when the editor height changes', async () => {
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		configurationService.setUserConfiguration('editor.scrollBeyondLastLine', true);
		const height = observableValue<number>('height', 600);

		renderWithHeight(height);
		expect(screen.getByTestId('container')).toHaveStyle({ paddingBottom: '550px' });

		await act(async () => {
			height.set(400, undefined);
		});

		expect(screen.getByTestId('container')).toHaveStyle({ paddingBottom: '350px' });
	});
});
