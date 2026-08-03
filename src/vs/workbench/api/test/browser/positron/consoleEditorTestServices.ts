/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { ILanguageConfigurationService } from '../../../../../editor/common/languages/languageConfigurationRegistry.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { LanguageService } from '../../../../../editor/common/services/languageService.js';
import { ModelService } from '../../../../../editor/common/services/modelService.js';
import { ITreeSitterLibraryService } from '../../../../../editor/common/services/treeSitter/treeSitterLibraryService.js';
import { TestCodeEditorService } from '../../../../../editor/test/browser/editorTestServices.js';
import { createTestCodeEditor, ITestCodeEditor } from '../../../../../editor/test/browser/testCodeEditor.js';
import { TestLanguageConfigurationService } from '../../../../../editor/test/common/modes/testLanguageConfigurationService.js';
import { TestTreeSitterLibraryService } from '../../../../../editor/test/common/services/testTreeSitterLibraryService.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestDialogService } from '../../../../../platform/dialogs/test/common/testDialogService.js';
import { ITextEditorDiffInformation } from '../../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { TestThemeService } from '../../../../../platform/theme/test/common/testThemeService.js';
import { IUndoRedoService } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { UndoRedoService } from '../../../../../platform/undoRedo/common/undoRedoService.js';
import { UriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentityService.js';
import { IQuickDiffModelService } from '../../../../contrib/scm/browser/quickDiffModel.js';
import { IPaneCompositePartService } from '../../../../services/panecomposite/browser/panecomposite.js';
import { ITextFileEditorModelManager, ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { IUntitledTextEditorModelManager } from '../../../../services/untitled/common/untitledTextEditorService.js';
import { TestEditorGroupsService, TestEditorService, TestEnvironmentService, TestPathService } from '../../../../test/browser/workbenchTestServices.js';
import { TestTextResourcePropertiesService, TestWorkingCopyFileService } from '../../../../test/common/workbenchTestServices.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { MainThreadDocumentsAndEditors } from '../../../browser/mainThreadDocumentsAndEditors.js';
import { IDocumentsAndEditorsDelta } from '../../../common/extHost.protocol.js';
import { SingleProxyRPCProtocol } from '../../common/testRPCProtocol.js';

/**
 * A real `MainThreadDocumentsAndEditors` plus the services it needs, wired for tests that
 * exercise the Positron-only console editor registration path.
 *
 * The wiring mirrors the upstream Mocha suite in `../mainThreadDocumentsAndEditors.test.ts`
 * (real `ModelService` + real test code editors) so that `ICodeEditor.onDidChangeModel` fires
 * genuinely when a model is attached -- the exact timing console editor registration depends on.
 *
 * Create one per test and `dispose()` it in `afterEach`.
 */
export class ConsoleEditorTestServices {

	/** Deltas the main thread sent to the (fake) extension host. */
	readonly deltas: IDocumentsAndEditorsDelta[] = [];

	/**
	 * Editor ids the main thread sent state for before the ext host knew about them. The real
	 * `ExtHostEditors` throws `unknown text editor` in this case, so anything recorded here is a
	 * bug in the ordering of the calls the main thread makes.
	 */
	readonly unknownEditorCalls: string[] = [];

	/** Editor ids the (fake) ext host currently knows about, per the deltas it received. */
	private readonly _knownEditorIds = new Set<string>();

	readonly modelService: ModelService;
	readonly documentsAndEditors: MainThreadDocumentsAndEditors;

	private readonly _codeEditorService: TestCodeEditorService;

	/** Long-lived services; disposed last, after everything that reads them. */
	private readonly _services = new DisposableStore();

	/**
	 * Editors, models and console registrations created by a test. Disposed while the main-thread
	 * instance is still alive so their `MainThreadTextEditor`s drain through the live state
	 * computer.
	 */
	private readonly _perTest = new DisposableStore();

	constructor() {
		const configService = new TestConfigurationService();
		configService.setUserConfiguration('editor', { 'detectIndentation': false });
		const dialogService = new TestDialogService();
		const notificationService = new TestNotificationService();
		const undoRedoService = new UndoRedoService(dialogService, notificationService);
		const themeService = new TestThemeService();
		// TestInstantiationService here only bootstraps the ModelService helper (per vitest-tests.md
		// exception), it is not used as the primary DI container for the class under test.
		const instantiationService = new TestInstantiationService();
		instantiationService.set(ILanguageService, this._services.add(new LanguageService()));
		instantiationService.set(ILanguageConfigurationService, this._services.add(new TestLanguageConfigurationService()));
		instantiationService.set(ITreeSitterLibraryService, new TestTreeSitterLibraryService());
		instantiationService.set(IUndoRedoService, undoRedoService);
		this.modelService = this._services.add(new ModelService(
			configService,
			new TestTextResourcePropertiesService(configService),
			undoRedoService,
			instantiationService
		));
		this._codeEditorService = this._services.add(new TestCodeEditorService(themeService));
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
		const workbenchEditorService = this._services.add(new TestEditorService());
		const editorGroupService = new TestEditorGroupsService();

		const fileService = new class extends mock<IFileService>() {
			override onDidRunOperation = Event.None;
			override onDidChangeFileSystemProviderCapabilities = Event.None;
			override onDidChangeFileSystemProviderRegistrations = Event.None;
		};

		this.documentsAndEditors = new MainThreadDocumentsAndEditors(
			SingleProxyRPCProtocol({
				$acceptDocumentsAndEditorsDelta: (delta: IDocumentsAndEditorsDelta) => {
					this.deltas.push(delta);
					delta.addedEditors?.forEach(e => this._knownEditorIds.add(e.id));
					delta.removedEditors?.forEach(id => this._knownEditorIds.delete(id));
				},
				$acceptEditorDiffInformation: (id: string, _diffInformation: ITextEditorDiffInformation | undefined) => {
					this._recordEditorIdLookup(id);
				},
				$acceptEditorPropertiesChanged: (id: string) => {
					this._recordEditorIdLookup(id);
				}
			}),
			this.modelService,
			textFileService,
			workbenchEditorService,
			this._codeEditorService,
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
			this._services.add(new UriIdentityService(fileService)),
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
	}

	/** Creates a test code editor, optionally with a model already attached. */
	createCodeEditor(model: ITextModel | undefined): ITestCodeEditor {
		return this._perTest.add(createTestCodeEditor(model, {
			hasTextFocus: false,
			serviceCollection: new ServiceCollection(
				[ICodeEditorService, this._codeEditorService]
			)
		}));
	}

	createModel(value: string): ITextModel {
		return this._perTest.add(this.modelService.createModel(value, null));
	}

	/** Registers a disposable owned by the current test (e.g. a console editor registration). */
	add<T extends { dispose(): void }>(disposable: T): T {
		return this._perTest.add(disposable);
	}

	/**
	 * Deltas emitted by `registerConsoleEditor` contain a single `addedEditors` entry whose id is
	 * the console id we passed; deltas from the ambient state computer use composite
	 * `${editorId},${modelId}` ids, so filtering by our exact id isolates the registration under
	 * test.
	 */
	consoleAdds(id: string): IDocumentsAndEditorsDelta[] {
		return this.deltas.filter(d => d.addedEditors?.some(e => e.id === id));
	}

	consoleRemoves(id: string): IDocumentsAndEditorsDelta[] {
		return this.deltas.filter(d => d.removedEditors?.includes(id));
	}

	/** Mimics the ext host resolving an editor id, recording the ones it can't resolve. */
	private _recordEditorIdLookup(id: string): void {
		if (!this._knownEditorIds.has(id)) {
			this.unknownEditorCalls.push(id);
		}
	}

	dispose(): void {
		this._perTest.dispose();
		this.documentsAndEditors.dispose();
		this._services.dispose();
	}
}
