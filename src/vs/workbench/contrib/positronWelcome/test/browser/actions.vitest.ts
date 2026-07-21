/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IFilesConfigurationService } from '../../../../services/filesConfiguration/common/filesConfigurationService.js';
import { IPreferencesService } from '../../../../services/preferences/common/preferences.js';
import { IUserDataProfileService } from '../../../../services/userDataProfile/common/userDataProfile.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { TextModelResolverService } from '../../../../services/textmodelResolver/common/textModelResolverService.js';
import { TestTextFileService } from '../../../../test/browser/workbenchTestServices.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronImportSettings } from '../../browser/actions.js';
import { ConfigurationEditing, EditableConfigurationTarget } from '../../../../services/configuration/common/configurationEditing.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../../platform/configuration/common/configurationRegistry.js';

const TEST_SETTING_KEY = 'positronImportSettingsTest.raceTestSetting';
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: '_positronImportSettingsTest',
	type: 'object',
	properties: {
		[TEST_SETTING_KEY]: { type: 'string', default: 'isSet' },
	},
});

const { mergeSettingsJsonMock } = vi.hoisted(() => ({ mergeSettingsJsonMock: vi.fn() }));

vi.mock('../../browser/helpers.js', () => ({
	getCodeSettingsPathNative: vi.fn(async () => URI.file('/code/settings.json')),
	getCodeSettingsPathWeb: vi.fn(async () => URI.file('/code/settings.json')),
	mergeSettingsJson: mergeSettingsJsonMock,
	setImportWasPrompted: vi.fn(),
	POSITRON_IMPORT_SETTINGS_COMMAND_ID: 'positron.workbench.action.importSettings',
}));

describe('PositronImportSettings', () => {
	const positronSettingsPath = URI.file('/positron/settings.json');

	// Regression test for the import-settings diff-preview race: a background
	// config write (theme migration, scrollback reset, files.associations) must
	// not be able to reload the preview model from disk. That guard only holds
	// once the model is dirty, so the model must become dirty before the editor
	// binds to it -- verifies the actual fix in this PR (mi/chivalrous-space).
	describe('dirties the settings model before opening the editor', () => {
		const callOrder: string[] = [];
		const fakeModel = {
			setLanguage: vi.fn(),
			setValue: vi.fn(() => { callOrder.push('setValue'); }),
		};
		const modelRef = {
			object: { textEditorModel: fakeModel },
			dispose: vi.fn(),
		};
		// PositronImportSettings.run() keeps its DisposableStore alive until the
		// user clicks Accept/Reject on the prompt -- capture the actions so the
		// test can close that loop the same way a real Accept click would.
		let promptActions: { label: string; run: () => Promise<void> }[] = [];

		const ctx = createTestContainer()
			.withWorkbenchServices()
			.stub(IPreferencesService, { getEditableSettingsURI: async () => positronSettingsPath })
			.stub(IFileService, { exists: async () => true, createFile: async () => undefined })
			.stub(ITextModelService, { createModelReference: async () => modelRef })
			.stub(IFilesConfigurationService, { disableAutoSave: () => Disposable.None })
			.stub(IEditorService, {
				openEditor: vi.fn(async () => { callOrder.push('openEditor'); return undefined; }),
				onDidCloseEditor: Event.None,
				activeEditor: undefined,
			})
			.stub(INotificationService, {
				prompt: vi.fn((_severity, _message, actions) => {
					promptActions = actions;
					return { close: vi.fn() };
				}),
			})
			.build();

		beforeEach(() => {
			mergeSettingsJsonMock.mockResolvedValue('"imported": true');
		});

		it('setValue runs before openEditor', async () => {
			const action = ctx.instantiationService.createInstance(PositronImportSettings);
			await ctx.instantiationService.invokeFunction(accessor => action.run(accessor));

			expect(fakeModel.setValue).toHaveBeenCalledTimes(1);
			expect(callOrder).toEqual(['setValue', 'openEditor']);

			// Simulate the user clicking Accept, so run()'s DisposableStore closes
			// the same way it would in real usage.
			await promptActions[0].run();
		});
	});

	// ConfigurationEditing's dirty guard originally only protected the
	// reload-from-disk path (TextFileEditorModel.resolve() bails when dirty).
	// It did NOT protect the direct edit-and-save path -- if a background
	// writer's validate() ran while the model was still clean, and the import
	// preview dirtied the model before that writer reached updateConfiguration(),
	// the writer's edit would apply and save on top of the dirty preview
	// (handleDirtyFile is never passed by these background writers), silently
	// clearing the dirty flag. A later "Reject" would then revert to the
	// just-auto-saved content instead of the true original file.
	// updateConfiguration() now re-checks isDirty immediately before applying
	// the edit, closing that gap.
	describe('a background write does not clobber the dirty import preview', () => {
		const ctx = createTestContainer()
			.withWorkbenchServices()
			.build();

		it('a background write does not clobber the dirty import preview', async () => {
			// withWorkbenchServices() eagerly constructs TextModelResolverService and
			// TestTextFileService with the preset's non-functional TestDirectoryFileService
			// baked in via constructor injection -- a late .stub(IFileService, ...) doesn't
			// reach them. Install a real FileService, then re-create both on top of it so
			// model resolve/save actually work against real (in-memory) file content.
			const realFileService = ctx.disposables.add(new FileService(new NullLogService()));
			ctx.disposables.add(realFileService.registerProvider(Schemas.vscodeUserData, ctx.disposables.add(new InMemoryFileSystemProvider())));
			ctx.instantiationService.stub(IFileService, realFileService);
			ctx.instantiationService.stub(ITextFileService, ctx.disposables.add(ctx.instantiationService.createInstance(TestTextFileService)));
			ctx.instantiationService.stub(ITextModelService, ctx.disposables.add(ctx.instantiationService.createInstance(TextModelResolverService)));

			const fileService = ctx.get(IFileService);
			const textModelService = ctx.get(ITextModelService);
			const userDataProfileService = ctx.get(IUserDataProfileService);

			const settingsResource = userDataProfileService.currentProfile.settingsResource;
			await fileService.writeFile(settingsResource, VSBuffer.fromString('{\n\t"positronImportSettingsTest.raceTestSetting": "original"\n}'));

			// Simulate PositronImportSettings.run() already holding a resolved
			// reference to the shared settings model.
			const previewRef = ctx.disposables.add(await textModelService.createModelReference(settingsResource));
			const model = previewRef.object.textEditorModel;

			// Intercept the FIRST createModelReference call made by ConfigurationEditing
			// itself (i.e. after its validate() already saw the model as clean) and dirty
			// the model at that exact point, before delegating to the real resolution --
			// this deterministically reproduces the race instead of hoping for CI timing.
			const realCreateModelReference = textModelService.createModelReference.bind(textModelService);
			let dirtiedOnce = false;
			vi.spyOn(textModelService, 'createModelReference').mockImplementation(async uri => {
				if (!dirtiedOnce) {
					dirtiedOnce = true;
					model.setValue('// Settings imported from Visual Studio Code\n{\n\t"positronImportSettingsTest.raceTestSetting": "original",\n\t"importedOnly": true\n}');
				}
				return realCreateModelReference(uri);
			});

			const configurationEditing = ctx.instantiationService.createInstance(ConfigurationEditing, null);

			// No handleDirtyFile -- matches the real background writers (theme
			// migration, scrollback reset, files.associations), none of which pass it.
			await configurationEditing.writeConfiguration(
				EditableConfigurationTarget.USER_LOCAL,
				{ key: TEST_SETTING_KEY, value: 'writerValue' },
				{},
			);

			// Desired behavior: the import preview survives untouched and stays
			// dirty until the user explicitly accepts or rejects it.
			expect(model.getValue()).not.toContain('writerValue');
			expect(ctx.get(ITextFileService).isDirty(settingsResource)).toBe(true);

			// Cleanup: TextFileEditorModelManager.canDispose() blocks disposal of a
			// dirty model until it sees onDidChangeDirty, and the manager's own
			// disposal of previewRef runs that check asynchronously -- both would
			// otherwise race the leak-detector's synchronous afterEach check. Dispose
			// the model directly (bypassing the manager's gate, since the test is its
			// sole remaining owner) so teardown is synchronous.
			previewRef.object.dispose();
		});
	});
});
