/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { useEffect } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { URI } from '../../../../../base/common/uri.js';
import { Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ILanguageRuntimeService, RuntimeStartupPhase } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { FolderTemplate } from '../../../../services/positronNewFolder/common/positronNewFolder.js';
import { NewFolderFlowContextProvider, useNewFolderFlowContext } from '../../newFolderFlowContext.js';
import { NewFolderFlowStep } from '../../interfaces/newFolderFlowEnums.js';
import { PythonEnvironmentStep } from '../../components/steps/pythonEnvironmentStep.js';

const UV_PROVIDER = { id: 'uv-id', name: 'uv', description: 'Creates a uv environment' };
const CONDA_PROVIDER = { id: 'conda-id', name: 'Conda', description: 'Creates a Conda environment' };

/** The step only reads these four members, and none of them vary between the suites below. */
const RUNTIME_SERVICE_STUB = {
	startupPhase: RuntimeStartupPhase.Complete,
	onDidChangeRuntimeStartupPhase: Event.None,
	onDidRegisterRuntime: Event.None,
	registeredRuntimes: [],
};

/**
 * Selects the Python folder template, which is what puts the flow on a new-environment path. The
 * step itself has no way to set it, so a sibling does it once the provider has built the state.
 * The provider never disposes the state it creates, so the test takes ownership of it here.
 */
const SelectPythonTemplate = (props: { onState: (state: IDisposable) => void }) => {
	const context = useNewFolderFlowContext();
	useEffect(() => {
		props.onState(context);
		context.folderTemplate = FolderTemplate.PythonProject;
		// The state is owned by the test for the lifetime of the suite, not by this effect.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [context]);
	return null;
};

/**
 * Renders the step on the Python environment page. Shared by both suites, which differ only in
 * which environment provider their command stub reports.
 */
function renderStep(
	rtl: ReturnType<typeof setupRTLRenderer>,
	ctx: { reactServices: PositronReactServices; disposables: { add<T extends IDisposable>(d: T): T } },
) {
	// The state manager reads the services singleton rather than the React context.
	PositronReactServices.services = ctx.reactServices;

	rtl.render(
		<NewFolderFlowContextProvider
			initialStep={NewFolderFlowStep.PythonEnvironment}
			parentFolder={URI.file('/Users/astrid/projects')}
		>
			<SelectPythonTemplate onState={state => ctx.disposables.add(state)} />
			<PythonEnvironmentStep
				accept={vi.fn()}
				back={vi.fn()}
				cancel={vi.fn()}
				next={vi.fn()}
			/>
		</NewFolderFlowContextProvider>
	);
}

// The sub step is a plain div with no role, so it is reached through its title. Scoping to it is
// the only way to tell which of the two sub steps the warning rendered in.
const envCreationSubStep = () => screen.getByText('Environment Creation').closest<HTMLElement>('.flow-sub-step')!;

describe('PythonEnvironmentStep uv install', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ILanguageRuntimeService, RUNTIME_SERVICE_STUB)
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	/**
	 * Renders the step with uv offered as an environment provider but not installed. The command
	 * stub is per-test because what the install resolves with is the variable under test.
	 * @param ensureUvInstalled What the 'python.ensureUvInstalled' command resolves with.
	 */
	function renderUvStep(ensureUvInstalled: unknown, providers = [UV_PROVIDER]) {
		let uvInstalled = false;
		const executeCommand = vi.fn(async (commandId: string) => {
			switch (commandId) {
				case 'python.getCreateEnvironmentProviders':
					return providers;
				case 'python.isUvInstalled':
					return uvInstalled;
				case 'python.getUvPythonVersions':
					return { versions: ['3.13', '3.12'] };
				case 'python.isCondaInstalled':
					return true;
				case 'python.getCondaPythonVersions':
					return { preferred: '3.11', versions: ['3.11'] };
				case 'python.ensureUvInstalled':
					// The real command only reports ok once uv is on disk, so mirror that here.
					uvInstalled = (ensureUvInstalled as { ok?: boolean })?.ok === true;
					return ensureUvInstalled;
				default:
					return undefined;
			}
		});

		ctx.instantiationService.stub(ICommandService, {
			executeCommand: executeCommand as unknown as ICommandService['executeCommand'],
		});
		renderStep(rtl, ctx);
		return { executeCommand };
	}

	const installButton = () => screen.findByRole('button', { name: 'Install uv' });

	/** Picks a provider from the Environment Creation dropdown by its name. */
	async function selectProvider(user: ReturnType<typeof userEvent.setup>, name: string) {
		// The dropdown is labelled with the provider it currently shows, whichever that is; the
		// only other button in the sub step is "Install uv".
		const dropdown = within(envCreationSubStep()).getByRole('button', { name: /environment$/ });
		await user.click(dropdown);
		// The popup entries have no role of their own, and their names repeat the descriptions
		// already on the dropdown, so the title is what tells them apart.
		await user.click(await screen.findByText(name, { selector: '.dropdown-entry-title' }));
	}

	it('offers to install uv, next to the provider that needs it, instead of dead-ending', async () => {
		renderUvStep({ ok: true });
		await installButton();

		// The offer belongs with the environment provider, not with the version list two sub
		// steps below, so the assertions are scoped to the provider's sub step.
		const envCreation = within(envCreationSubStep());
		expect(envCreation.getByText('uv is not installed')).toBeInTheDocument();
		expect(envCreation.getByRole('button', { name: 'Install uv' })).toBeInTheDocument();
		// The version dropdown names the blocker rather than claiming an empty search, since no
		// version lookup can happen without uv.
		expect(screen.getByText('Install uv to select a Python version')).toBeInTheDocument();
		expect(screen.queryByText('No versions found.')).not.toBeInTheDocument();
	});

	it('replaces the button with the Python versions after installing', async () => {
		const user = userEvent.setup();
		const { executeCommand } = renderUvStep({ ok: true });

		await user.click(await installButton());

		expect(executeCommand).toHaveBeenCalledWith('python.ensureUvInstalled');
		await waitFor(() => expect(screen.queryByText('uv is not installed')).not.toBeInTheDocument());
		expect(screen.queryByRole('button', { name: 'Install uv' })).not.toBeInTheDocument();
		expect(await screen.findByText('Select a Python version')).toBeInTheDocument();
	});

	it('keeps the offer in place when the user declines the install', async () => {
		const user = userEvent.setup();
		renderUvStep({ ok: false });

		await user.click(await installButton());

		expect(await screen.findByText('uv is not installed')).toBeInTheDocument();
		expect(await installButton()).toBeInTheDocument();
	});

	it('does not claim to be installing while consent is still being asked', async () => {
		const user = userEvent.setup();
		// The command does not resolve until the consent prompt is answered, so an unresolved
		// promise stands in for the moment that prompt is on screen.
		let answerPrompt!: (result: unknown) => void;
		renderUvStep(new Promise((resolve) => { answerPrompt = resolve; }));

		await user.click(await installButton());

		// Nothing is installing yet, so the button must not say it is; it is only inert because
		// the question it raised is still open.
		expect(screen.queryByRole('button', { name: 'Installing uv...' })).not.toBeInTheDocument();
		expect(await installButton()).toHaveAttribute('aria-disabled', 'true');

		answerPrompt({ ok: false });
	});

	it('drops the failure message when the provider changes, since nothing was attempted there', async () => {
		const user = userEvent.setup();
		renderUvStep({ ok: false, error: 'Failed to install uv.' }, [UV_PROVIDER, CONDA_PROVIDER]);

		await user.click(await installButton());
		expect(await screen.findByText('Failed to install uv.')).toBeInTheDocument();

		await selectProvider(user, 'Conda');
		await selectProvider(user, 'uv');

		// The message is left over from the previous visit, so it blames this one for a failure
		// it never had, and hides the real state: uv is simply not installed.
		expect(await screen.findByText('uv is not installed')).toBeInTheDocument();
		expect(screen.queryByText('Failed to install uv.')).not.toBeInTheDocument();
	});

	it('reports why the install failed', async () => {
		const user = userEvent.setup();
		renderUvStep({ ok: false, error: 'uv was not found after installing it.' });

		await user.click(await installButton());

		expect(await screen.findByText('uv was not found after installing it.')).toBeInTheDocument();
	});
});

/**
 * Builds a container whose only environment provider is Conda, reporting the given install state.
 * Each suite below gets its own so the command stub stays constant within a suite.
 * @param condaInstalled What the 'python.isCondaInstalled' command reports, or a promise a test
 * resolves itself to control when it answers.
 * @param versions The Python versions Conda offers once it is installed.
 */
function condaContainer(condaInstalled: boolean | Promise<boolean>, versions: string[]) {
	const executeCommand = vi.fn(async (commandId: string) => {
		switch (commandId) {
			case 'python.getCreateEnvironmentProviders':
				return [CONDA_PROVIDER];
			case 'python.isCondaInstalled':
				return condaInstalled;
			case 'python.getCondaPythonVersions':
				return { preferred: versions[0], versions };
			default:
				return undefined;
		}
	});

	return createTestContainer()
		.withReactServices()
		.stub(ICommandService, {
			executeCommand: executeCommand as unknown as ICommandService['executeCommand'],
		})
		.stub(ILanguageRuntimeService, RUNTIME_SERVICE_STUB)
		.build();
}

describe('PythonEnvironmentStep Conda not installed', () => {
	const ctx = condaContainer(false, []);
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('says Conda is missing, next to the provider, rather than claiming no providers were found', async () => {
		renderStep(rtl, ctx);

		// The message used to be unreachable: the new-environment branch returned first, so a
		// missing Conda was reported as a missing provider while Conda sat selected above it.
		expect(await within(envCreationSubStep()).findByText('Conda is not installed')).toBeInTheDocument();
		expect(screen.queryByText(
			'No interpreters available since no environment providers were found.'
		)).not.toBeInTheDocument();
	});

	it('names the blocker in the version dropdown rather than reporting an empty search', async () => {
		renderStep(rtl, ctx);

		// No version lookup can happen without Conda, so "No versions found." would describe a
		// search that never ran.
		expect(await screen.findByText('Install Conda to select a Python version')).toBeInTheDocument();
		expect(screen.queryByText('No versions found.')).not.toBeInTheDocument();
	});
});

describe('PythonEnvironmentStep Conda installed', () => {
	// The providers load one render before the install check answers, so this suite holds
	// 'python.isCondaInstalled' open to make that in-between window observable.
	let reportCondaInstalled!: (installed: boolean) => void;
	const ctx = condaContainer(
		new Promise<boolean>(resolve => { reportCondaInstalled = resolve; }),
		['3.12', '3.11']
	);
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('waits for the install check to answer before reporting Conda missing', async () => {
		renderStep(rtl, ctx);

		// An install state that is still unknown is not a missing one, so nothing should be
		// claimed about Conda in this window.
		expect(await screen.findByText('Environment Creation')).toBeInTheDocument();
		expect(screen.queryByText('Conda is not installed')).not.toBeInTheDocument();

		reportCondaInstalled(true);

		// The version list only renders once the versions are in, which is proof the check landed.
		expect(await screen.findByText('Select a Python version')).toBeInTheDocument();
		expect(screen.queryByText('Conda is not installed')).not.toBeInTheDocument();
	});
});
