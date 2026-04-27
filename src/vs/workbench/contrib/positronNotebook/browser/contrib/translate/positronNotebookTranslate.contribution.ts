/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../../nls.js';
import { registerAction2, MenuId } from '../../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../../platform/quickinput/common/quickInput.js';
import { IProgressService, ProgressLocation } from '../../../../../../platform/progress/common/progress.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { basename, dirname, extname, joinPath } from '../../../../../../base/common/resources.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { IDialogService } from '../../../../../../platform/dialogs/common/dialogs.js';
import { NotebookAction2 } from '../../NotebookAction2.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../../common/positronNotebookCommon.js';
import { ILanguageModelsService } from '../../../../chat/common/languageModels.js';
import { POSITRON_NOTEBOOK_TRANSLATE_ENABLED_KEY } from './config.js';
import { SUPPORTED_LANGUAGES, isKnownLanguageCode, ITranslationProvider } from './translationLanguages.js';
import { AssistantTranslationProvider } from './translationProvider.js';
import { splitMarkdown, reassemble, Segment } from './markdownProtection.js';

const POSITRON_NOTEBOOK_CATEGORY = localize2('positronNotebook.category', 'Notebook');

registerAction2(class TranslateMarkdownCellsAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.translateMarkdownCells',
			title: localize2('positronNotebook.translateMarkdownCells', "Translate Markdown Cells"),
			icon: ThemeIcon.fromId('globe'),
			f1: true,
			category: POSITRON_NOTEBOOK_CATEGORY,
			precondition: ContextKeyExpr.equals(`config.${POSITRON_NOTEBOOK_TRANSLATE_ENABLED_KEY}`, true),
			menu: {
				id: MenuId.EditorActionsLeft,
				group: 'navigation',
				order: 50,
				when: ContextKeyExpr.and(
					ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
					ContextKeyExpr.equals(`config.${POSITRON_NOTEBOOK_TRANSLATE_ENABLED_KEY}`, true),
				),
			},
		});
	}

	override async runNotebookAction(
		notebook: IPositronNotebookInstance,
		accessor: ServicesAccessor,
	): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const progressService = accessor.get(IProgressService);
		const fileService = accessor.get(IFileService);
		const editorService = accessor.get(IEditorService);
		const dialogService = accessor.get(IDialogService);
		const languageModelsService = accessor.get(ILanguageModelsService);

		const sourceUri = notebook.uri;

		if (sourceUri.scheme === 'untitled') {
			notificationService.notify({
				severity: Severity.Info,
				message: localize(
					'positronNotebook.translate.unsaved',
					'Please save the notebook before translating.'
				),
			});
			return;
		}

		const ext = extname(sourceUri);
		const base = basename(sourceUri);
		const nameWithoutExt = base.slice(0, base.length - ext.length);
		const detectedCode = detectLanguageFromFilename(nameWithoutExt);

		let sourceCode: string;
		let targetCode: string;

		if (detectedCode) {
			// Already-translated file: skip source picker, go straight to target
			sourceCode = detectedCode;
			const sourceLang = SUPPORTED_LANGUAGES.find(l => l.code === detectedCode);
			const targetPick = await pickLanguage(
				quickInputService,
				SUPPORTED_LANGUAGES
					.filter(lang => lang.code !== detectedCode)
					.map(lang => ({ id: lang.code, label: lang.label })),
				localize(
					'positronNotebook.translate.titleTargetDetected',
					'Translate from {0} to...',
					sourceLang?.label ?? detectedCode
				),
				localize('positronNotebook.translate.pickTarget', 'Select the target language'),
			);
			if (!targetPick?.id) {
				return;
			}
			targetCode = targetPick.id;
		} else {
			// No language detected: show both pickers
			const sourcePick = await pickLanguage(
				quickInputService,
				SUPPORTED_LANGUAGES.map(lang => ({
					id: lang.code,
					label: lang.label,
				})),
				localize('positronNotebook.translate.titleSource', 'Translate Markdown Cells - Source Language'),
				localize('positronNotebook.translate.pickSource', 'Select the source language of the notebook'),
			);
			if (!sourcePick?.id) {
				return;
			}
			sourceCode = sourcePick.id;

			const targetPick = await pickLanguage(
				quickInputService,
				SUPPORTED_LANGUAGES
					.filter(lang => lang.code !== sourcePick.id)
					.map(lang => ({ id: lang.code, label: lang.label })),
				localize('positronNotebook.translate.titleTarget', 'Translate Markdown Cells - Target Language'),
				localize('positronNotebook.translate.pickTarget', 'Select the target language'),
			);
			if (!targetPick?.id) {
				return;
			}
			targetCode = targetPick.id;
		}

		let ipynb: IpynbNotebook;
		try {
			const fileContent = await fileService.readFile(sourceUri);
			ipynb = JSON.parse(fileContent.value.toString());
		} catch (err) {
			notificationService.notify({
				severity: Severity.Error,
				message: localize(
					'positronNotebook.translate.readError',
					'Failed to read notebook: {0}',
					err instanceof Error ? err.message : String(err)
				),
			});
			return;
		}

		const markdownCells = ipynb.cells.filter(c => c.cell_type === 'markdown');
		if (markdownCells.length === 0) {
			notificationService.notify({
				severity: Severity.Info,
				message: localize(
					'positronNotebook.translate.noMarkdown',
					'No Markdown cells found in this notebook.'
				),
			});
			return;
		}

		const strippedBase = stripLanguageSuffixes(nameWithoutExt);
		const newName = `${strippedBase}-${targetCode}${ext}`;
		const targetUri = joinPath(dirname(sourceUri), newName);

		if (await fileService.exists(targetUri)) {
			const { confirmed } = await dialogService.confirm({
				message: localize(
					'positronNotebook.translate.overwrite',
					'"{0}" already exists. Overwrite it?',
					newName
				),
			});
			if (!confirmed) {
				return;
			}
		}

		const targetLabel = SUPPORTED_LANGUAGES.find(l => l.code === targetCode)?.label ?? targetCode;
		let cancelled = false;

		await progressService.withProgress(
			{
				location: ProgressLocation.Notification,
				title: localize(
					'positronNotebook.translate.progress',
					'Translating markdown cells to {0}...',
					targetLabel
				),
				cancellable: true,
			},
			async (progress) => {
				const provider = new AssistantTranslationProvider(languageModelsService);
				let translatedCount = 0;
				let errorCount = 0;

				for (let i = 0; i < markdownCells.length; i++) {
					if (cancelled) {
						break;
					}

					const cell = markdownCells[i];
					const originalSource = Array.isArray(cell.source)
						? cell.source.join('')
						: cell.source;

					if (!originalSource.trim()) {
						continue;
					}

					progress.report({
						increment: (100 / markdownCells.length),
						message: localize(
							'positronNotebook.translate.progressCell',
							'Cell {0} of {1}',
							i + 1,
							markdownCells.length
						),
					});

					try {
						const result = await translateMarkdownSource(originalSource, sourceCode, targetCode, provider);

						if (result !== originalSource) {
							cell.source = result.split('\n').map(
								(line, idx, arr) => idx < arr.length - 1 ? line + '\n' : line
							);
							translatedCount++;
						}
					} catch (err) {
						errorCount++;
						if (errorCount <= 3) {
							notificationService.notify({
								severity: Severity.Warning,
								message: localize(
									'positronNotebook.translate.cellError',
									'Failed to translate cell {0}: {1}',
									i + 1,
									err instanceof Error ? err.message : String(err)
								),
							});
						}
					}
				}

				if (cancelled) {
					return;
				}

				if (errorCount > 3) {
					notificationService.notify({
						severity: Severity.Warning,
						message: localize(
							'positronNotebook.translate.moreErrors',
							'{0} more cell(s) failed to translate.',
							errorCount - 3
						),
					});
				}

				if (translatedCount === 0) {
					notificationService.notify({
						severity: Severity.Info,
						message: errorCount > 0
							? localize(
								'positronNotebook.translate.allFailed',
								'Translation failed for all cells. Check that a language model provider is configured and try again.'
							)
							: localize(
								'positronNotebook.translate.noChanges',
								'No cells were translated. The content may already be in the target language.'
							),
					});
					return;
				}

				const content = VSBuffer.fromString(JSON.stringify(ipynb, null, 1));
				await fileService.writeFile(targetUri, content);
				await editorService.openEditor({ resource: targetUri });

				notificationService.notify({
					severity: Severity.Info,
					message: localize(
						'positronNotebook.translate.done',
						'Translated {0} cell(s). Saved as "{1}".',
						translatedCount,
						newName
					),
				});
			},
			() => { cancelled = true; },
		);
	}
});

async function pickLanguage(
	quickInputService: IQuickInputService,
	items: IQuickPickItem[],
	title: string,
	placeHolder: string,
): Promise<IQuickPickItem | undefined> {
	return quickInputService.pick(items, { title, placeHolder });
}

/**
 * Translates markdown source segment-by-segment to avoid line-count mismatches.
 * Each translatable segment is sent individually, and failures fall back to the original text.
 */
async function translateMarkdownSource(
	source: string,
	sourceLanguage: string,
	targetLanguage: string,
	provider: ITranslationProvider,
): Promise<string> {
	const segments = splitMarkdown(source);
	const result: Segment[] = [...segments];
	let anyTranslated = false;

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		if (!seg.translatable || !seg.text.trim()) {
			continue;
		}

		const translated = await provider.translate(seg.text, sourceLanguage, targetLanguage);
		if (translated && translated !== seg.text) {
			result[i] = { text: translated, translatable: true };
			anyTranslated = true;
		}
	}

	return anyTranslated ? reassemble(result) : source;
}

export function detectLanguageFromFilename(nameWithoutExt: string): string | undefined {
	const parts = nameWithoutExt.split('-');
	if (parts.length < 2) {
		return undefined;
	}
	const last = parts[parts.length - 1];
	return isKnownLanguageCode(last) ? last : undefined;
}

export function stripLanguageSuffixes(nameWithoutExt: string): string {
	const parts = nameWithoutExt.split('-');
	while (parts.length > 1 && isKnownLanguageCode(parts[parts.length - 1])) {
		parts.pop();
	}
	return parts.join('-');
}

interface IpynbCell {
	cell_type: string;
	source: string | string[];
	[key: string]: unknown;
}

interface IpynbNotebook {
	cells: IpynbCell[];
	[key: string]: unknown;
}
