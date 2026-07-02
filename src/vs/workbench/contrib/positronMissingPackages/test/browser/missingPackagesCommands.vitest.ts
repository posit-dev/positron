/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ServiceIdentifier, ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IProgressService } from '../../../../../platform/progress/common/progress.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IMissingPackagesResult, IMissingPackagesService } from '../../common/missingPackagesService.js';
import { CheckMissingPackagesAction, InstallMissingPackagesAction } from '../../browser/missingPackagesCommands.js';

// Mock the modal so tests drive the user's decision without rendering UI.
const { showModal } = vi.hoisted(() => ({ showModal: vi.fn<(...args: unknown[]) => Promise<boolean>>() }));
vi.mock('../../browser/missingPackagesInstallModal.js', () => ({
	showMissingPackagesInstallModal: showModal,
}));

describe('Missing packages commands', () => {
	const resource = URI.file('/foo.py');
	const result: IMissingPackagesResult = {
		resource,
		groups: [{ sessionId: 'py', languageId: 'python', packages: [{ name: 'requests' }] }],
		total: 1,
	};

	// `activeResource: null` means "no active editor"; `cached`/`ensured` default
	// to the missing-package result.
	function setup(options: { activeResource?: URI | null; ensured?: IMissingPackagesResult } = {}) {
		const ensured = options.ensured ?? result;
		const ensure = vi.fn().mockResolvedValue(ensured);
		const installAll = vi.fn().mockResolvedValue(undefined);
		const missingPackagesService = stubInterface<IMissingPackagesService>({ ensure, installAll });

		const activeResource = options.activeResource === undefined ? resource : options.activeResource ?? undefined;
		const editorService = stubInterface<IEditorService>({
			activeEditor: activeResource ? stubInterface<EditorInput>({ resource: activeResource }) : undefined,
		});

		// Run the wrapped task immediately, ignoring the progress reporter.
		const progressService = stubInterface<IProgressService>({
			withProgress: (_options, task) => task({ report: () => { } }),
		});

		const info = vi.fn();
		const warn = vi.fn();
		const notificationService = stubInterface<INotificationService>({ info, warn });

		const languageService = stubInterface<ILanguageService>({ getLanguageName: () => 'Python' });

		const services = new Map<unknown, unknown>([
			[IMissingPackagesService, missingPackagesService],
			[IEditorService, editorService],
			[IProgressService, progressService],
			[INotificationService, notificationService],
			[ILanguageService, languageService],
		]);
		const accessor: ServicesAccessor = {
			get: <T,>(id: ServiceIdentifier<T>): T => services.get(id) as T,
		};

		return { accessor, ensure, installAll, info, warn };
	}

	describe('Install Missing Packages', () => {
		it('installs without prompting and reports success', async () => {
			const { accessor, installAll, info } = setup();
			await new InstallMissingPackagesAction().run(accessor);
			expect(showModal).not.toHaveBeenCalled();
			expect(installAll).toHaveBeenCalledWith(result);
			expect(info).toHaveBeenCalled();
		});

		it('reports nothing to install when no packages are missing', async () => {
			const { accessor, installAll, info } = setup({ ensured: { resource, groups: [], total: 0 } });
			await new InstallMissingPackagesAction().run(accessor);
			expect(installAll).not.toHaveBeenCalled();
			expect(info).toHaveBeenCalled();
		});

		it('does nothing but notify when there is no active editor', async () => {
			const { accessor, ensure, installAll, info } = setup({ activeResource: null });
			await new InstallMissingPackagesAction().run(accessor);
			expect(ensure).not.toHaveBeenCalled();
			expect(installAll).not.toHaveBeenCalled();
			expect(info).toHaveBeenCalled();
		});
	});

	describe('Check for Missing Packages', () => {
		it('installs when the user confirms the modal', async () => {
			const { accessor, installAll } = setup();
			showModal.mockResolvedValue(true);
			await new CheckMissingPackagesAction().run(accessor);
			expect(showModal).toHaveBeenCalled();
			expect(installAll).toHaveBeenCalledWith(result);
		});

		it('does not install when the user cancels the modal', async () => {
			const { accessor, installAll } = setup();
			showModal.mockResolvedValue(false);
			await new CheckMissingPackagesAction().run(accessor);
			expect(showModal).toHaveBeenCalled();
			expect(installAll).not.toHaveBeenCalled();
		});

		it('reports all installed without prompting when nothing is missing', async () => {
			const { accessor, info } = setup({ ensured: { resource, groups: [], total: 0 } });
			await new CheckMissingPackagesAction().run(accessor);
			expect(showModal).not.toHaveBeenCalled();
			expect(info).toHaveBeenCalled();
		});
	});
});
