/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Emitter } from '../../../../../base/common/event.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ILanguageRuntimePackage, IRuntimeSessionMetadata, ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronPackagesService } from '../../browser/interfaces/positronPackagesService.js';
import { IPositronPackagesInstance } from '../../browser/positronPackagesInstance.js';
import { IPackageVulnerabilitySource } from '../../browser/packageVulnerabilityLookup.js';
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

function makeInstance(
	pkgs: ILanguageRuntimePackage[],
	sessionId = SESSION_ID,
	vulnerabilitySource: IPackageVulnerabilitySource | undefined = undefined,
): IPositronPackagesInstance {
	return stubInterface<IPositronPackagesInstance>({
		packages: pkgs,
		session: makeSession(sessionId),
		onDidRefreshPackagesInstance: new Emitter<ILanguageRuntimePackage[]>().event,
		getPackageDetail: vi.fn().mockResolvedValue(undefined),
		vulnerabilitySource,
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

	it('renders the package name immediately and the description once the fetch resolves', async () => {
		render();
		// The name is list-derived, so it paints right away.
		expect(screen.getByRole('heading', { name: 'dplyr' })).toBeInTheDocument();
		// The subtitle is held behind a skeleton until the detail fetch resolves
		// (here to no detail), then falls back to the list description.
		expect(await screen.findByText('A grammar of data manipulation')).toBeInTheDocument();
	});

	it('shows an Update button for an outdated package and runs the update command', async () => {
		render();
		const user = userEvent.setup();
		const update = screen.getByRole('button', { name: /update/i });
		await user.click(update);
		// The update runs directly with the target version (no version prompt).
		expect(executeCommand).toHaveBeenCalledWith('positronPackages.updatePackage', 'dplyr', '1.1.4');
	});

	it('shows the Overview stat strip once the fetch resolves', async () => {
		render();
		// The Overview is held back until the detail fetch resolves; the LICENSE
		// stat ("MIT") is the last piece to appear.
		expect(await screen.findByText('MIT')).toBeInTheDocument();     // LICENSE stat
		// The version appears twice: faded next to the name and as the VERSION stat.
		expect(screen.getAllByText('1.1.2')).toHaveLength(2);
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

describe('PackageDetail after uninstall', () => {
	const executeCommand = vi.fn();
	const refresh = new Emitter<ILanguageRuntimePackage[]>();
	// A current (not outdated) package, so `latestVersion` is unset -- the exact
	// case where reading `latestVersion` used to leave the version undefined and
	// drop the Install button into the search quick-pick.
	const packages = [dplyr({ version: '1.1.2', outdated: false })];
	const instance = stubInterface<IPositronPackagesInstance>({
		packages,
		session: makeSession(SESSION_ID),
		onDidRefreshPackagesInstance: refresh.event,
		getPackageDetail: vi.fn().mockResolvedValue(undefined),
		vulnerabilitySource: undefined,
	});
	const packagesService = stubInterface<IPositronPackagesService>({
		getInstances: () => [instance],
		activePackagesInstance: instance,
		onDidChangeActivePackagesInstance: new Emitter<IPositronPackagesInstance | undefined>().event,
		onDidStopPackagesInstance: new Emitter<IPositronPackagesInstance>().event,
	});
	const ctx = createTestContainer().withReactServices().stub(ICommandService, { executeCommand }).build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('reinstalls the previously-installed version when Install is clicked after uninstall', async () => {
		rtl.render(
			<PackageDetail languageId='r' packageName='dplyr' packagesService={packagesService} sessionId={SESSION_ID} />
		);
		const user = userEvent.setup();

		// Uninstall: the package leaves the installed list and the refresh event
		// drives the re-render. The detail view retains the last-known package data.
		packages.length = 0;
		act(() => refresh.fire([]));

		// Clicking the Install button reinstalls the version that was installed
		// (1.1.2) directly -- not `latestVersion`, and with no version quick-pick.
		await user.click(screen.getByRole('button', { name: /install/i }));
		expect(executeCommand).toHaveBeenCalledWith('positronPackages.installPackage', 'dplyr', '1.1.2');
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

	it('appends "(latest)" to the installed version and omits a Latest version row', async () => {
		rtl.render(
			<PackageDetail languageId='r' packageName='dplyr' packagesService={packagesService} sessionId={SESSION_ID} />
		);
		// Installed-version Overview row reads "1.1.4 (latest)" (appears once the
		// fetch resolves); the faded header version is the bare "1.1.4".
		expect(await screen.findByText('1.1.4 (latest)')).toBeInTheDocument();
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

describe('PackageDetail Security tab', () => {
	const SOURCE: IPackageVulnerabilitySource = {
		host: 'ppm.example.com',
		// Local midday, so the rendered date is 2026-08-13 in every time zone.
		// The lookup timestamp is a local event and is displayed as one.
		fetchedAt: new Date(2026, 7, 13, 12).getTime(),
	};

	function renderWithVulnerabilities(
		vulnerabilities: ILanguageRuntimePackage['vulnerabilities'],
		source?: IPackageVulnerabilitySource,
	) {
		const instance = makeInstance([dplyr({ vulnerabilities })], SESSION_ID, source);
		const packagesService = stubInterface<IPositronPackagesService>({
			getInstances: () => [instance],
			activePackagesInstance: instance,
			onDidChangeActivePackagesInstance: new Emitter<IPositronPackagesInstance | undefined>().event,
			onDidStopPackagesInstance: new Emitter<IPositronPackagesInstance>().event,
		});
		rtl.render(
			<PackageDetail languageId='r' packageName='dplyr' packagesService={packagesService} sessionId={SESSION_ID} />
		);
	}

	const ctx = createTestContainer().withReactServices().stub(ICommandService, { executeCommand: vi.fn() }).build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('lists advisories with severity, linked id, summary, and fix version once Security is selected', async () => {
		renderWithVulnerabilities([{
			id: 'CVE-2018-6594',
			osvId: 'GHSA-6528-wvf6-f6qg',
			score: 8.7,
			scoreVersion: 'v4',
			summary: 'Pycrypto generates weak key parameters',
			fixedIn: '2.7.0',
			published: '2018-02-03T15:29:00Z',
			url: 'https://nvd.nist.gov/vuln/detail/CVE-2018-6594',
		}]);
		const user = userEvent.setup();

		// The tab carries the advisory count so the signal survives being moved
		// off the Overview; the advisories themselves are a click away. Both
		// panels stay mounted so each tab's aria-controls resolves, so the
		// inactive one is hidden rather than absent.
		const securityTab = screen.getByRole('tab', { name: 'Security, 1 known vulnerability' });
		expect(screen.getByText('Pycrypto generates weak key parameters')).not.toBeVisible();
		await user.click(securityTab);

		// Severity chip: band label + score, tagged with the CVSS revision.
		expect(screen.getByText('High 8.7')).toBeInTheDocument();
		expect(screen.getByText('CVSS v4')).toBeInTheDocument();
		// The advisory id is a button that opens the NVD page.
		expect(screen.getByRole('button', { name: 'Open advisory CVE-2018-6594' })).toBeInTheDocument();
		expect(screen.getByText('Pycrypto generates weak key parameters')).toBeInTheDocument();
		expect(screen.getByText('Fixed in 2.7.0')).toBeInTheDocument();
		expect(screen.getByText('Published 2018-02-03')).toBeInTheDocument();
		// Selecting Security swaps the panel; the Overview's Metadata is hidden.
		expect(screen.getByText('Metadata')).not.toBeVisible();
	});

	it('shows an unscored advisory without a score or CVSS tag', async () => {
		renderWithVulnerabilities([{
			id: 'RSEC-2023-7',
			osvId: 'RSEC-2023-7',
			summary: 'Denial of Service (DoS) vulnerabilities',
			fixedIn: '1.8',
		}]);
		const user = userEvent.setup();

		await user.click(screen.getByRole('tab', { name: 'Security, 1 known vulnerability' }));

		// No score: the chip reads as severity-unknown, and no CVSS tag renders.
		expect(screen.getByText('Severity unknown')).toBeInTheDocument();
		expect(screen.queryByText(/CVSS/)).not.toBeInTheDocument();
	});

	it('attributes an empty advisory list to the instance and date that reported it', async () => {
		// An instance whose advisory data is stale or absent reports every
		// package as clean, and nothing in its response says so. Naming the
		// source and date is what makes the all-clear checkable rather than an
		// unearned claim.
		renderWithVulnerabilities([], SOURCE);
		const user = userEvent.setup();

		// Nothing to count, so the tab is offered without a badge.
		await user.click(screen.getByRole('tab', { name: 'Security' }));

		expect(screen.getByText('No advisories reported by ppm.example.com as of 2026-08-13.')).toBeInTheDocument();
	});

	it('attributes a non-empty advisory list to the instance and date that reported it', async () => {
		renderWithVulnerabilities([{ id: 'RSEC-2023-7', osvId: 'RSEC-2023-7', summary: 'DoS' }], SOURCE);
		const user = userEvent.setup();

		await user.click(screen.getByRole('tab', { name: 'Security, 1 known vulnerability' }));

		expect(screen.getByText('Reported by ppm.example.com as of 2026-08-13.')).toBeInTheDocument();
	});

	it('makes no claim about which instance reported when the source is unknown', async () => {
		renderWithVulnerabilities([]);
		const user = userEvent.setup();

		await user.click(screen.getByRole('tab', { name: 'Security' }));

		expect(screen.getByText('No advisories were reported for this version.')).toBeInTheDocument();
	});

	it('offers no Security tab when no vulnerability data is available', async () => {
		// undefined = unknown (no PPM, or package/version not in the repo):
		// neither a warning nor an unearned all-clear.
		renderWithVulnerabilities(undefined);

		// Wait for the Overview (Metadata section) to render, then check.
		expect(await screen.findByText('Metadata')).toBeInTheDocument();
		expect(screen.queryByRole('tab', { name: /security/i })).not.toBeInTheDocument();
	});

	it('moves between tabs with the arrow keys', async () => {
		renderWithVulnerabilities([{ id: 'RSEC-2023-7', osvId: 'RSEC-2023-7', summary: 'DoS' }]);
		const user = userEvent.setup();

		const overviewTab = screen.getByRole('tab', { name: 'Overview' });
		const securityTab = screen.getByRole('tab', { name: 'Security, 1 known vulnerability' });
		overviewTab.focus();

		// Selection follows focus, so the right arrow both moves and selects.
		await user.keyboard('{ArrowRight}');
		expect(securityTab).toHaveFocus();
		expect(securityTab).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByText('DoS')).toBeInTheDocument();

		// And wraps back around to the Overview.
		await user.keyboard('{ArrowRight}');
		expect(overviewTab).toHaveFocus();
		expect(overviewTab).toHaveAttribute('aria-selected', 'true');
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

	it('shows header skeletons and hides the Overview while the fetch is pending', () => {
		rtl.render(
			<PackageDetail languageId='r' packageName='dplyr' packagesService={packagesService} sessionId={SESSION_ID} />
		);
		// Author and subtitle render as fixed-height skeletons so the header
		// doesn't jump when the detail fetch resolves.
		expect(screen.getAllByTestId('package-detail-loading')).toHaveLength(2);
		// The Overview (and its detail-only rows) stays hidden until the fetch resolves.
		expect(screen.queryByText('MIT')).not.toBeInTheDocument();
	});
});

describe('PackageDetail for bundled packages', () => {
	const executeCommand = vi.fn();
	const ctx = createTestContainer().withReactServices().stub(ICommandService, { executeCommand }).build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function tornado(overrides: Partial<ILanguageRuntimePackage> = {}): ILanguageRuntimePackage {
		return { id: 'tornado', name: 'tornado', displayName: 'tornado', version: '6.5.7', bundled: true, ...overrides };
	}

	function renderPackage(pkg: ILanguageRuntimePackage) {
		const instance = makeInstance([pkg]);
		const packagesService = stubInterface<IPositronPackagesService>({
			getInstances: () => [instance],
			activePackagesInstance: instance,
			onDidChangeActivePackagesInstance: new Emitter<IPositronPackagesInstance | undefined>().event,
			onDidStopPackagesInstance: new Emitter<IPositronPackagesInstance>().event,
		});
		rtl.render(
			<PackageDetail languageId='python' packageName='tornado' packagesService={packagesService} sessionId={SESSION_ID} />
		);
	}

	it('labels a bundled-only package, explains it, and offers no Update or Uninstall', async () => {
		renderPackage(tornado({ outdated: false }));

		expect(screen.getByText('Bundled with Positron')).toBeInTheDocument();
		// Rendered as plain text, so Markdown backticks would show literally.
		expect(screen.getByText(/ships with Positron and can't be uninstalled from the Packages pane/)).not.toHaveTextContent('`');
		// A restart keeps the session's bundled import path; only a new session
		// picks up the setting change.
		expect(screen.getByText(/ships with Positron/)).toHaveTextContent(/start a new Python session\.$/);
		expect(screen.getByText('python.useBundledIpykernel', { selector: 'code' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /uninstall/i })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /update/i })).not.toBeInTheDocument();
		// The version is the bundled copy's, never "(latest)": outdated state
		// describes the environment, which has no copy.
		expect(await screen.findByText('6.5.7, bundled')).toBeInTheDocument();
		expect(screen.queryByText(/\(latest\)/)).not.toBeInTheDocument();
	});

	it('opens the bundled ipykernel setting from the explanation', async () => {
		renderPackage(tornado());
		const user = userEvent.setup();

		await user.click(screen.getByRole('button', { name: 'Open the python.useBundledIpykernel setting' }));

		expect(executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', 'python.useBundledIpykernel');
	});

	it('explains that the console imports the bundled copy when the environment also has one', async () => {
		renderPackage(tornado({ environmentVersion: '6.5.10', outdated: false }));

		expect(screen.getByText('Bundled with Positron')).toBeInTheDocument();
		expect(screen.getByText('Your environment has 6.5.10, but the console imports the bundled 6.5.7. Update and Uninstall act on the environment copy.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Uninstall' })).toBeEnabled();
		// "(latest)" attaches to the environment copy, not the bundled one.
		expect(await screen.findByText('6.5.10 (latest)')).toBeInTheDocument();
		expect(screen.getByText('6.5.7, bundled')).toBeInTheDocument();
	});

	it('offers to update the environment copy when it is outdated', () => {
		renderPackage(tornado({ environmentVersion: '6.4.0', outdated: true, latestVersion: '6.5.10' }));

		expect(screen.getByRole('button', { name: 'Update to 6.5.10' })).toBeEnabled();
	});

	it('says updating the environment copy does not fix an advisory on the bundled copy', async () => {
		renderPackage(tornado({
			environmentVersion: '6.4.0',
			outdated: true,
			latestVersion: '6.5.10',
			vulnerabilities: [{ id: 'CVE-2025-0001', osvId: 'GHSA-xxxx-yyyy-zzzz', score: 7.5, scoreVersion: 'v3' }],
		}));
		const user = userEvent.setup();

		await user.click(screen.getByRole('tab', { name: 'Security, 1 known vulnerability' }));

		expect(screen.getByText(/These advisories are for the bundled 6.5.7 the console imports\. Updating the environment copy does not fix them/)).toBeInTheDocument();
	});

	it('says a fix for a bundled-only advisory comes with a Positron update', async () => {
		renderPackage(tornado({
			vulnerabilities: [{ id: 'CVE-2025-0001', osvId: 'GHSA-xxxx-yyyy-zzzz', score: 7.5, scoreVersion: 'v3' }],
		}));
		const user = userEvent.setup();

		await user.click(screen.getByRole('tab', { name: 'Security, 1 known vulnerability' }));

		expect(screen.getByText(/A fix for the bundled copy comes with a Positron update/)).not.toHaveTextContent('`');
		const advisoryNote = screen.getByText(/A fix for the bundled copy/);
		expect(advisoryNote).toHaveTextContent(/start a new Python session\.$/);
		expect(within(advisoryNote).getByText('python.useBundledIpykernel', { selector: 'code' })).toBeInTheDocument();
	});
});
