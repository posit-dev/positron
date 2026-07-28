/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { MainThreadDocumentsAndEditors } from '../../../browser/mainThreadDocumentsAndEditors.js';
import { SingleProxyRPCProtocol } from '../../common/testRPCProtocol.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ModelService } from '../../../../../editor/common/services/modelService.js';
import { TestCodeEditorService } from '../../../../../editor/test/browser/editorTestServices.js';
import { ITextFileEditorModelManager, ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { IUntitledTextEditorModelManager } from '../../../../services/untitled/common/untitledTextEditorService.js';
import { IDocumentsAndEditorsDelta } from '../../../common/extHost.protocol.js';
import { createTestCodeEditor, ITestCodeEditor } from '../../../../../editor/test/browser/testCodeEditor.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { TestEditorService, TestEditorGroupsService, TestEnvironmentService, TestPathService } from '../../../../test/browser/workbenchTestServices.js';
import { Event } from '../../../../../base/common/event.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { TestThemeService } from '../../../../../platform/theme/test/common/testThemeService.js';
import { UndoRedoService } from '../../../../../platform/undoRedo/common/undoRedoService.js';
import { TestDialogService } from '../../../../../platform/dialogs/test/common/testDialogService.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { TestTextResourcePropertiesService, TestWorkingCopyFileService } from '../../../../test/common/workbenchTestServices.js';
import { UriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentityService.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IPaneCompositePartService } from '../../../../services/panecomposite/browser/panecomposite.js';
import { ITextEditorDiffInformation } from '../../../../../platform/editor/common/editor.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { LanguageService } from '../../../../../editor/common/services/languageService.js';
import { ILanguageConfigurationService } from '../../../../../editor/common/languages/languageConfigurationRegistry.js';
import { TestLanguageConfigurationService } from '../../../../../editor/test/common/modes/testLanguageConfigurationService.js';
import { IUndoRedoService } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { IQuickDiffModelService } from '../../../../contrib/scm/browser/quickDiffModel.js';
import { ITreeSitterLibraryService } from '../../../../../editor/common/services/treeSitter/treeSitterLibraryService.js';
import { TestTreeSitterLibraryService } from '../../../../../editor/test/common/services/testTreeSitterLibraryService.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';

// Tests for the Positron-only `MainThreadDocumentsAndEditors.registerConsoleEditor` method, which
// backs `positron.window.activeConsoleEditor`. The setup mirrors the upstream Mocha suite in
// `../mainThreadDocumentsAndEditors.test.ts` (real ModelService + real test code editors) so that
// `ICodeEditor.onDidChangeModel` fires genuinely when a model is attached -- the exact timing the
// fix depends on.
describe('MainThreadDocumentsAndEditors (Positron console editor)', () => {

	// Long-lived services (disposed after the per-test teardown below runs).
	const disposables = ensureNoLeakedDisposables();

	let modelService: ModelService;
	let codeEditorService: TestCodeEditorService;
	let documentsAndEditors: MainThreadDocumentsAndEditors;
	// Editors, models and console registrations created within a test. Disposed while the
	// main-thread instance is still alive so their `MainThreadTextEditor`s drain through the live
	// state computer, then the instance itself is disposed in `afterEach`.
	let perTest: DisposableStore;
	const deltas: IDocumentsAndEditorsDelta[] = [];

	function createCodeEditor(model: ITextModel | undefined): ITestCodeEditor {
		return perTest.add(createTestCodeEditor(model, {
			hasTextFocus: false,
			serviceCollection: new ServiceCollection(
				[ICodeEditorService, codeEditorService]
			)
		}));
	}

	function createModel(value: string): ITextModel {
		return perTest.add(modelService.createModel(value, null));
	}

	// Deltas emitted by `registerConsoleEditor` contain a single `addedEditors` entry whose id is the
	// console id we passed; deltas from the ambient state computer use composite `${editorId},${modelId}`
	// ids, so filtering by our exact id isolates the registration under test.
	function consoleAdds(id: string): IDocumentsAndEditorsDelta[] {
		return deltas.filter(d => d.addedEditors?.some(e => e.id === id));
	}

	function consoleRemoves(id: string): IDocumentsAndEditorsDelta[] {
		return deltas.filter(d => d.removedEditors?.includes(id));
	}

	beforeEach(() => {
		deltas.length = 0;
		perTest = new DisposableStore();

		const configService = new TestConfigurationService();
		configService.setUserConfiguration('editor', { 'detectIndentation': false });
		const dialogService = new TestDialogService();
		const notificationService = new TestNotificationService();
		const undoRedoService = new UndoRedoService(dialogService, notificationService);
		const themeService = new TestThemeService();
		// TestInstantiationService here only bootstraps the ModelService helper (per vitest-tests.md
		// exception), it is not used as the primary DI container for the class under test.
		const instantiationService = new TestInstantiationService();
		instantiationService.set(ILanguageService, disposables.add(new LanguageService()));
		instantiationService.set(ILanguageConfigurationService, disposables.add(new TestLanguageConfigurationService()));
		instantiationService.set(ITreeSitterLibraryService, new TestTreeSitterLibraryService());
		instantiationService.set(IUndoRedoService, undoRedoService);
		modelService = disposables.add(new ModelService(
			configService,
			new TestTextResourcePropertiesService(configService),
			undoRedoService,
			instantiationService
		));
		codeEditorService = disposables.add(new TestCodeEditorService(themeService));
		const textFileService = new class extends mock<ITextFileService>() {
			override isDirty() { return false; }
			// Only the events subscribed by MainThreadDocuments's constructor are read here.
			override files = stubInterface<ITextFileEditorModelManager>({
				onDidSave: Event.None,
				onDidChangeDirty: Event.None,
				onDidChangeEncoding: Event.None
			});
			override untitled = stubInterface<IUntitledTextEditorModelManager>({
				onDidChangeEncoding: Event.None
			});
			override getEncoding() { return 'utf8'; }
		};
		const workbenchEditorService = disposables.add(new TestEditorService());
		const editorGroupService = new TestEditorGroupsService();

		const fileService = new class extends mock<IFileService>() {
			override onDidRunOperation = Event.None;
			override onDidChangeFileSystemProviderCapabilities = Event.None;
			override onDidChangeFileSystemProviderRegistrations = Event.None;
		};

		documentsAndEditors = new MainThreadDocumentsAndEditors(
			SingleProxyRPCProtocol({
				$acceptDocumentsAndEditorsDelta: (delta: IDocumentsAndEditorsDelta) => { deltas.push(delta); },
				$acceptEditorDiffInformation: (_id: string, _diffInformation: ITextEditorDiffInformation | undefined) => { }
			}),
			modelService,
			textFileService,
			workbenchEditorService,
			codeEditorService,
			fileService,
			null!,
			editorGroupService,
			new class extends mock<IPaneCompositePartService>() implements IPaneCompositePartService {
				override onDidPaneCompositeOpen = Event.None;
				override onDidPaneCompositeClose = Event.None;
				override getActivePaneComposite() {
					return undefined;
				}
			},
			TestEnvironmentService,
			new TestWorkingCopyFileService(),
			disposables.add(new UriIdentityService(fileService)),
			new class extends mock<IClipboardService>() {
				override readText() {
					return Promise.resolve('clipboard_contents');
				}
			},
			new TestPathService(),
			new TestConfigurationService(),
			new class extends mock<IQuickDiffModelService>() {
				override createQuickDiffModelReference() {
					return undefined;
				}
			}
		);
	});

	// Registered after `ensureNoLeakedDisposables`, so it runs before the leak check (Vitest runs
	// afterEach hooks in reverse registration order): drain the test's editors/models first, then
	// tear down the main-thread instance.
	afterEach(() => {
		perTest.dispose();
		documentsAndEditors.dispose();
	});

	it('registers immediately when the code editor already has a model', () => {
		const model = createModel('> ');
		const editor = createCodeEditor(model);

		const store = documentsAndEditors.registerConsoleEditor('console-1', editor);

		expect(consoleAdds('console-1')).toHaveLength(1);

		// Disposing the registration removes the editor from the ext host.
		store.dispose();
		expect(consoleRemoves('console-1')).toHaveLength(1);
	});

	it('defers registration until a model is attached (the fix)', () => {
		// Console input assigns its code editor before the text model attaches.
		const editor = createCodeEditor(undefined);

		perTest.add(documentsAndEditors.registerConsoleEditor('console-2', editor));

		// Nothing registered yet -- a regression that bailed on the missing model would leave
		// `activeConsoleEditor` permanently unresolved here.
		expect(consoleAdds('console-2')).toHaveLength(0);

		// Attaching the model fires `onDidChangeModel` with a new url, which triggers registration.
		editor.setModel(createModel('> '));
		expect(consoleAdds('console-2')).toHaveLength(1);

		// A later model swap must not register the console editor a second time.
		editor.setModel(createModel('>> '));
		expect(consoleAdds('console-2')).toHaveLength(1);
	});
});
