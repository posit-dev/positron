/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '../../../../../base/common/errors.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfirmation, IConfirmationResult, IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IProgress, IProgressService, IProgressStep, Progress } from '../../../../../platform/progress/common/progress.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronPackagesService } from '../../browser/interfaces/positronPackagesService.js';
import { PACKAGES_CAN_UNINSTALL_SELECTION, PACKAGES_CAN_UPDATE_SELECTION, POSITRON_PACKAGES_ENABLED } from '../../browser/positronPackagesContextKeys.js';

const { UpdateSelectedPackageAction, UninstallSelectedPackageAction } = await import('../../browser/positronPackages.contribution.js');

describe('selected package actions', () => {
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.build();

	let executeCommand: ReturnType<typeof vi.fn<(commandId: string, ...args: unknown[]) => Promise<undefined>>>;
	let updateOutdatedPackages: ReturnType<typeof vi.fn<IPositronPackagesService['updateOutdatedPackages']>>;
	let uninstallPackages: ReturnType<typeof vi.fn<IPositronPackagesService['uninstallPackages']>>;
	let confirm: ReturnType<typeof vi.fn<(confirmation: IConfirmation) => Promise<IConfirmationResult>>>;
	let info: ReturnType<typeof vi.fn<INotificationService['info']>>;
	let prompt: ReturnType<typeof vi.fn<INotificationService['prompt']>>;
	let error: ReturnType<typeof vi.fn<INotificationService['error']>>;
	/** When set, the progress notification's Cancel is clicked before the task runs. */
	let cancelProgress: boolean;

	function stubServices(selectedPackages: readonly string[]): void {
		ctx.instantiationService.stub(IPositronPackagesService, stubInterface<IPositronPackagesService>({
			activeSession: stubInterface<ILanguageRuntimeSession>({ sessionId: 'session-1' }),
			selectedPackages,
			selectedPackage: selectedPackages.length === 1 ? selectedPackages[0] : undefined,
			updateOutdatedPackages,
			uninstallPackages,
		}));
		ctx.instantiationService.stub(INotificationService, stubInterface<INotificationService>({ error, info, prompt }));
		ctx.instantiationService.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({ restartSession: vi.fn() }));
		ctx.instantiationService.stub(ICommandService, stubInterface<ICommandService>({
			executeCommand: <R = unknown>(commandId: string, ...args: unknown[]): Promise<R | undefined> => executeCommand(commandId, ...args),
		}));
		ctx.instantiationService.stub(IDialogService, stubInterface<IDialogService>({ confirm }));
		ctx.instantiationService.stub(IProgressService, stubInterface<IProgressService>({
			withProgress: <R>(_options: unknown, task: (progress: IProgress<IProgressStep>) => Promise<R>, onDidCancel?: (choice?: number) => void): Promise<R> => {
				if (cancelProgress) {
					onDidCancel?.();
				}
				return task(Progress.None);
			},
		}));
	}

	beforeEach(() => {
		executeCommand = vi.fn<(commandId: string, ...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined);
		updateOutdatedPackages = vi.fn<IPositronPackagesService['updateOutdatedPackages']>().mockResolvedValue([]);
		uninstallPackages = vi.fn<IPositronPackagesService['uninstallPackages']>().mockResolvedValue(undefined);
		confirm = vi.fn().mockResolvedValue({ confirmed: true });
		info = vi.fn<INotificationService['info']>();
		prompt = vi.fn<INotificationService['prompt']>();
		error = vi.fn<INotificationService['error']>();
		cancelProgress = false;
	});

	function runUpdate() {
		const action = new UpdateSelectedPackageAction();
		return ctx.instantiationService.invokeFunction(accessor => action.run(accessor));
	}

	function runUninstall() {
		const action = new UninstallSelectedPackageAction();
		return ctx.instantiationService.invokeFunction(accessor => action.run(accessor));
	}

	function promptMessage(): string {
		return String(prompt.mock.calls[0][1]);
	}

	it('gates on the selection expressions combined with the enabled key', () => {
		expect(new UpdateSelectedPackageAction().desc.precondition?.equals(
			ContextKeyExpr.and(POSITRON_PACKAGES_ENABLED, PACKAGES_CAN_UPDATE_SELECTION)!)).toBe(true);
		expect(new UninstallSelectedPackageAction().desc.precondition?.equals(
			ContextKeyExpr.and(POSITRON_PACKAGES_ENABLED, PACKAGES_CAN_UNINSTALL_SELECTION)!)).toBe(true);
	});

	describe('with one package selected', () => {
		beforeEach(() => stubServices(['dplyr']));

		it('delegates Update to updatePackage with the name', async () => {
			await runUpdate();
			expect(executeCommand).toHaveBeenCalledWith('positronPackages.updatePackage', 'dplyr');
			expect(updateOutdatedPackages).not.toHaveBeenCalled();
		});

		it('delegates Uninstall to uninstallPackage with the name', async () => {
			await runUninstall();
			expect(executeCommand).toHaveBeenCalledWith('positronPackages.uninstallPackage', 'dplyr');
			expect(uninstallPackages).not.toHaveBeenCalled();
		});
	});

	describe('with several packages selected', () => {
		beforeEach(() => stubServices(['dplyr', 'ggplot2']));

		it('updates them in one call and reports what changed', async () => {
			updateOutdatedPackages.mockResolvedValue(['dplyr']);

			await runUpdate();

			expect(updateOutdatedPackages).toHaveBeenCalledTimes(1);
			expect(updateOutdatedPackages.mock.calls[0][0]).toEqual(['dplyr', 'ggplot2']);
			expect(executeCommand).not.toHaveBeenCalled();
			expect(prompt).toHaveBeenCalledTimes(1);
			expect(promptMessage()).toContain('"dplyr"');
			expect(promptMessage()).not.toContain('ggplot2');
			expect(promptMessage()).toContain('updated');
		});

		it('says so when nothing was updated', async () => {
			await runUpdate();

			expect(info).toHaveBeenCalledWith('No selected packages were updated.');
			expect(prompt).not.toHaveBeenCalled();
		});

		it('uninstalls them after one confirmation and shows one restart notice', async () => {
			await runUninstall();

			expect(confirm).toHaveBeenCalledTimes(1);
			expect(uninstallPackages).toHaveBeenCalledTimes(1);
			expect(uninstallPackages.mock.calls[0][0]).toEqual(['dplyr', 'ggplot2']);
			expect(prompt).toHaveBeenCalledTimes(1);
			expect(promptMessage()).toContain('"dplyr", "ggplot2"');
			expect(promptMessage()).toContain('uninstalled');
		});

		it('names the packages in the confirmation', async () => {
			await runUninstall();
			expect(confirm.mock.calls[0][0].message).toContain('\u0027dplyr\u0027, \u0027ggplot2\u0027');
		});

		it('does nothing when the confirmation is declined', async () => {
			confirm.mockResolvedValue({ confirmed: false });

			await runUninstall();

			expect(uninstallPackages).not.toHaveBeenCalled();
			expect(prompt).not.toHaveBeenCalled();
		});

		it('reports a failed bulk update as an error with no restart notice', async () => {
			updateOutdatedPackages.mockRejectedValue(new Error('boom'));

			await runUpdate();

			expect(error).toHaveBeenCalledTimes(1);
			expect(prompt).not.toHaveBeenCalled();
		});

		it('reports a failed bulk uninstall as an error with no restart notice', async () => {
			uninstallPackages.mockRejectedValue(new Error('boom'));

			await runUninstall();

			expect(error).toHaveBeenCalledTimes(1);
			expect(prompt).not.toHaveBeenCalled();
		});
	});

	describe('when cancelled', () => {
		beforeEach(() => stubServices(['dplyr', 'ggplot2']));

		it('shows nothing when the bulk update rejects with a cancellation error', async () => {
			updateOutdatedPackages.mockRejectedValue(new CancellationError());

			await runUpdate();

			expect(error).not.toHaveBeenCalled();
			expect(prompt).not.toHaveBeenCalled();
			expect(info).not.toHaveBeenCalled();
		});

		it('shows nothing when the bulk update resolves after the token was cancelled', async () => {
			cancelProgress = true;
			updateOutdatedPackages.mockResolvedValue(['dplyr']);

			await runUpdate();

			expect(error).not.toHaveBeenCalled();
			expect(prompt).not.toHaveBeenCalled();
			expect(info).not.toHaveBeenCalled();
		});

		it('shows nothing when the bulk update fails after the token was cancelled', async () => {
			cancelProgress = true;
			updateOutdatedPackages.mockRejectedValue(new Error('aborted'));

			await runUpdate();

			expect(error).not.toHaveBeenCalled();
			expect(prompt).not.toHaveBeenCalled();
		});

		it('shows nothing when the bulk uninstall rejects with a cancellation error', async () => {
			uninstallPackages.mockRejectedValue(new CancellationError());

			await runUninstall();

			expect(error).not.toHaveBeenCalled();
			expect(prompt).not.toHaveBeenCalled();
		});

		it('shows no restart notice when the bulk uninstall resolves after the token was cancelled', async () => {
			cancelProgress = true;

			await runUninstall();

			expect(error).not.toHaveBeenCalled();
			expect(prompt).not.toHaveBeenCalled();
		});

		it('shows nothing when the bulk uninstall fails after the token was cancelled', async () => {
			cancelProgress = true;
			uninstallPackages.mockRejectedValue(new Error('aborted'));

			await runUninstall();

			expect(error).not.toHaveBeenCalled();
			expect(prompt).not.toHaveBeenCalled();
		});
	});

	it('counts the packages in the confirmation when more than three are selected', async () => {
		stubServices(['a', 'b', 'c', 'd']);

		await runUninstall();

		expect(confirm.mock.calls[0][0].message).toContain('4 packages');
		expect(confirm.mock.calls[0][0].message).not.toMatch(/\u0027a\u0027/);
	});
});
