/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assertType } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';
import { usingNativeEmbeddedFeatures } from '../common/positronQuartoConfig.js';
import { GGSQL_LANGUAGE, hasRuntimeProvider, ICellRuntimeContext, isRunnableCell, rendersWithKnitr, runtimeLanguageOf } from '../common/quartoLanguages.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';

/**
 * Which of a Quarto document's cell languages Positron takes over from the
 * Quarto extension, told to the extension through a command so that Positron
 * can take on a language without a release of the extension.
 *
 * The extension serves a language Positron does not claim from its own
 * temporary documents, and runs it with its own executors; for a language
 * Positron claims, it stands down. Asking rather than keeping a list of its
 * own is what keeps the two from both answering for the same cell.
 */

/** The setting that switches Positron's SQL support, positron-sql's, on. */
const SQL_ENABLED_KEY = 'sql.enabled';

/**
 * The cell languages whose editor features Positron serves: R and Python
 * always, SQL and ggsql while SQL support is on. None while Positron is not
 * serving cells at all.
 *
 * SQL only with the setting, because nothing else in Positron answers for a
 * SQL cell: claiming it with the setting off would take the cell away from any
 * SQL extension the user has, which the Quarto extension would otherwise reach
 * through its temporary documents.
 */
export function hostOwnedCellLanguages(servingCells: boolean, sqlEnabled: boolean): string[] {
	if (!servingCells) {
		return [];
	}
	return sqlEnabled ? ['r', 'python', 'sql', GGSQL_LANGUAGE] : ['r', 'python'];
}

/**
 * `_quartoHostOwnedCellLanguages(): string[]`: see {@link hostOwnedCellLanguages}.
 * The answer changes with settings; the extension asks again when they change.
 */
CommandsRegistry.registerCommand('_quartoHostOwnedCellLanguages', accessor => {
	const configurationService = accessor.get(IConfigurationService);
	return hostOwnedCellLanguages(
		usingNativeEmbeddedFeatures(configurationService),
		configurationService.getValue<boolean>(SQL_ENABLED_KEY) === true,
	);
});

/** The ggsql extension, as published to the extension gallery. */
const GGSQL_EXTENSION_ID = 'ggsql.ggsql';

/**
 * Tells the user why a cell does not run, if it does not; the Run button and,
 * through `_quartoHostExplainUnrunnableCell`, the Quarto extension's commands
 * both say it the same way.
 *
 * @returns Whether there was anything to explain: false for a cell that runs.
 */
export function explainUnrunnableCell(
	cellLanguage: string,
	document: ICellRuntimeContext,
	services: {
		runtimeStartupService: IRuntimeStartupService;
		notificationService: INotificationService;
		commandService: ICommandService;
	},
): boolean {
	const { runtimeStartupService, notificationService, commandService } = services;
	if (isRunnableCell(cellLanguage, document, runtimeStartupService)) {
		return false;
	}
	if (cellLanguage.toLowerCase() === 'sql' && rendersWithKnitr(document)) {
		notificationService.info(localize('quarto.cannotRun.sqlRunsAtRender',
			"SQL cells in a document rendered with knitr run when the document is rendered, against the connection the chunk names."));
	} else if (runtimeLanguageOf(cellLanguage, document) === GGSQL_LANGUAGE
		&& !hasRuntimeProvider(GGSQL_LANGUAGE, runtimeStartupService)) {
		notificationService.prompt(Severity.Info,
			localize('quarto.cannotRun.installGgsql', "Install the ggsql extension to run {0} cells.", cellLanguage),
			[{
				label: localize('quarto.cannotRun.installGgsqlAction', "Install ggsql"),
				run: () => commandService.executeCommand('extension.open', GGSQL_EXTENSION_ID),
			}]);
	} else {
		notificationService.info(localize('quarto.cannotRun', "There is nothing in Positron to run {0} cells.", cellLanguage));
	}
	return true;
}

/**
 * `_quartoHostExplainUnrunnableCell(documentUri, cellLanguage): boolean`: see
 * {@link explainUnrunnableCell}.
 */
CommandsRegistry.registerCommand('_quartoHostExplainUnrunnableCell', (accessor, ...args: [URI, string]) => {
	const [uri, cellLanguage] = args;
	assertType(URI.isUri(uri));
	assertType(typeof cellLanguage === 'string');

	const textModel = accessor.get(IModelService).getModel(uri);
	const document: ICellRuntimeContext = textModel
		? accessor.get(IQuartoDocumentModelService).getModel(textModel)
		: { primaryLanguage: undefined, knitrEngine: undefined, cells: [] };
	return explainUnrunnableCell(cellLanguage, document, {
		runtimeStartupService: accessor.get(IRuntimeStartupService),
		notificationService: accessor.get(INotificationService),
		commandService: accessor.get(ICommandService),
	});
});
