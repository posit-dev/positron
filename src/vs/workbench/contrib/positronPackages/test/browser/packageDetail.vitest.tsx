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
		getPackageDetail: vi.fn().mockResolvedValue(undefined),
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
		// The update runs directly with the target version (no version prompt).
		expect(executeCommand).toHaveBeenCalledWith('positronPackages.updatePackage', 'dplyr', '1.1.4');
	});

	it('shows the Overview stat strip', () => {
		render();
		// The version appears twice: faded next to the name and as the VERSION stat.
		expect(screen.getAllByText('1.1.2')).toHaveLength(2);
		expect(screen.getByText('MIT')).toBeInTheDocument();     // LICENSE stat
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

describe('PackageDetail when the package is current', () => {
	const instance = makeInstance([dplyr({ version: '1.1.4', outdated: false, latestVersion: '1.1.4' })]);
	const packagesService = stubInterface<IPositronPackagesService>({
		getInstances: () => [instance],
		activePackagesInstance: instance,
		onDidChangeActivePackagesInstance: new Emitter<IPositronPackagesInstance | undefined>().event,
		onDidStopPackagesInstance: new Emitter<IPositronPackagesInstance>().event,
	});
	const ctx = createTestContainer().withReactServices().stub(ICommandService, { executeCommand: vi.fn() }).build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('appends "(latest)" to the installed version and omits a Latest version row', () => {
		rtl.render(
			<PackageDetail languageId='r' packageName='dplyr' packagesService={packagesService} sessionId={SESSION_ID} />
		);
		// Installed-version Overview row reads "1.1.4 (latest)"; the faded header
		// version is the bare "1.1.4".
		expect(screen.getByText('1.1.4 (latest)')).toBeInTheDocument();
		expect(screen.getByText('1.1.4')).toBeInTheDocument();
	});
});

describe('PackageDetail when the package is attached', () => {
	const instance = makeInstance([dplyr({ attached: true })]);
	const packagesService = stubInterface<IPositronPackagesService>({
		getInstances: () => [instance],
		activePackagesInstance: instance,
		onDidChangeActivePackagesInstance: new Emitter<IPositronPackagesInstance | undefined>().event,
		onDidStopPackagesInstance: new Emitter<IPositronPackagesInstance>().event,
	});
	const ctx = createTestContainer().withReactServices().stub(ICommandService, { executeCommand: vi.fn() }).build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('shows an "Attached" pill', () => {
		rtl.render(
			<PackageDetail languageId='r' packageName='dplyr' packagesService={packagesService} sessionId={SESSION_ID} />
		);
		expect(screen.getByText('Attached')).toBeInTheDocument();
	});
});

describe('PackageDetail with resolved detail fields', () => {
	const instance = makeInstance([dplyr()]);
	(instance.getPackageDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
		title: 'A grammar of data manipulation (extended)',
		author: 'Hadley Wickham',
		sourceRepository: 'CRAN',
		publishedDate: '2024-11-17 08:30:05 UTC',
	});
	const packagesService = stubInterface<IPositronPackagesService>({
		getInstances: () => [instance],
		activePackagesInstance: instance,
		onDidChangeActivePackagesInstance: new Emitter<IPositronPackagesInstance | undefined>().event,
		onDidStopPackagesInstance: new Emitter<IPositronPackagesInstance>().event,
	});
	const ctx = createTestContainer().withReactServices().stub(ICommandService, { executeCommand: vi.fn() }).build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('renders the author, title, and source repository after the fetch resolves', async () => {
		rtl.render(
			<PackageDetail languageId='r' packageName='dplyr' packagesService={packagesService} sessionId={SESSION_ID} />
		);
		expect(await screen.findByText('Hadley Wickham')).toBeInTheDocument();
		// The fetched title (differs from the description) becomes the header subtitle.
		expect(await screen.findByText('A grammar of data manipulation (extended)')).toBeInTheDocument();
		expect(await screen.findByText('CRAN')).toBeInTheDocument();   // Metadata: source repository
		// The published date is normalized to YYYY-MM-DD (time/zone stripped).
		expect(await screen.findByText('2024-11-17')).toBeInTheDocument();
	});
});

describe('PackageDetail while detail fetch is pending', () => {
	const instance = makeInstance([dplyr()]);
	(instance.getPackageDetail as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => { /* never resolves */ }));
	const packagesService = stubInterface<IPositronPackagesService>({
		getInstances: () => [instance],
		activePackagesInstance: instance,
		onDidChangeActivePackagesInstance: new Emitter<IPositronPackagesInstance | undefined>().event,
		onDidStopPackagesInstance: new Emitter<IPositronPackagesInstance>().event,
	});
	const ctx = createTestContainer().withReactServices().stub(ICommandService, { executeCommand: vi.fn() }).build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('shows loading skeletons for detail-only rows while the fetch is pending', () => {
		rtl.render(
			<PackageDetail languageId='r' packageName='dplyr' packagesService={packagesService} sessionId={SESSION_ID} />
		);
		const skeletons = screen.getAllByTestId('package-detail-loading');
		expect(skeletons.length).toBeGreaterThan(0);
	});
});
