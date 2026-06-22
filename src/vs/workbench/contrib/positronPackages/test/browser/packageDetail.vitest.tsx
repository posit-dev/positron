/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Emitter } from '../../../../../base/common/event.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ILanguageRuntimePackage, IRuntimeSessionMetadata, ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronPackagesService } from '../../browser/interfaces/positronPackagesService.js';
import { IPositronPackagesInstance } from '../../browser/positronPackagesInstance.js';
import { PackageDetail } from '../../browser/components/packageDetail.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';

const SESSION_ID = 's1';
const OTHER_SESSION_ID = 'other';

function makeSession(sessionId: string): ILanguageRuntimeSession {
	const metadata = stubInterface<IRuntimeSessionMetadata>({ sessionId });
	const runtimeMetadata = stubInterface<ILanguageRuntimeMetadata>({
		languageId: 'r',
		runtimeName: 'R 4.3.1',
	});
	return stubInterface<ILanguageRuntimeSession>({ metadata, runtimeMetadata });
}

function makeInstance(pkgs: ILanguageRuntimePackage[], sessionId = SESSION_ID): IPositronPackagesInstance {
	return stubInterface<IPositronPackagesInstance>({
		packages: pkgs,
		session: makeSession(sessionId),
		onDidRefreshPackagesInstance: new Emitter<ILanguageRuntimePackage[]>().event,
	});
}

function dplyr(overrides: Partial<ILanguageRuntimePackage> = {}): ILanguageRuntimePackage {
	return {
		id: 'dplyr', name: 'dplyr', displayName: 'dplyr', version: '1.1.2',
		license: 'MIT', url: 'https://dplyr.tidyverse.org', description: 'A grammar of data manipulation',
		...overrides,
	};
}

describe('PackageDetail', () => {
	const executeCommand = vi.fn();
	const instance = makeInstance([dplyr({ outdated: true, latestVersion: '1.1.4' })]);
	const packagesService = stubInterface<IPositronPackagesService>({
		getInstances: () => [instance],
		activePackagesInstance: instance,
		onDidChangeActivePackagesInstance: new Emitter<IPositronPackagesInstance | undefined>().event,
		onDidStopPackagesInstance: new Emitter<IPositronPackagesInstance>().event,
	});

	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function render() {
		rtl.render(
			<PackageDetail
				languageId='r'
				packageName='dplyr'
				packagesService={packagesService}
				sessionId={SESSION_ID}
			/>
		);
	}

	it('renders the package name and description', () => {
		render();
		expect(screen.getByRole('heading', { name: 'dplyr' })).toBeInTheDocument();
		expect(screen.getByText('A grammar of data manipulation')).toBeInTheDocument();
	});

	it('shows an Update button for an outdated package and runs the update command', async () => {
		render();
		const user = userEvent.setup();
		const update = screen.getByRole('button', { name: /update/i });
		await user.click(update);
		expect(executeCommand).toHaveBeenCalledWith('positronPackages.updatePackage', 'dplyr');
	});

	it('shows the Overview metadata that is present', () => {
		render();
		expect(screen.getByText('1.1.2')).toBeInTheDocument();   // installed version
		expect(screen.getByText('1.1.4')).toBeInTheDocument();   // latest version
		expect(screen.getByText('MIT')).toBeInTheDocument();     // license
	});
});

describe('PackageDetail when session is not active', () => {
	const executeCommand = vi.fn();
	const instance = makeInstance([dplyr()]);
	const otherInstance = makeInstance([], OTHER_SESSION_ID);
	const packagesService = stubInterface<IPositronPackagesService>({
		getInstances: () => [instance],
		activePackagesInstance: otherInstance,
		onDidChangeActivePackagesInstance: new Emitter<IPositronPackagesInstance | undefined>().event,
		onDidStopPackagesInstance: new Emitter<IPositronPackagesInstance>().event,
	});
	const ctx = createTestContainer().withReactServices().stub(ICommandService, { executeCommand }).build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('shows the not-active hint and disables package actions', () => {
		rtl.render(
			<PackageDetail languageId='r' packageName='dplyr' packagesService={packagesService} sessionId={SESSION_ID} />
		);
		expect(screen.getByText(/not the active session/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /uninstall/i })).toBeDisabled();
	});
});
