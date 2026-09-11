/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * Activation event fired before the importer list is read, so extensions that contribute importers
 * activate in time to register them. Contributing extensions declare it in `activationEvents`.
 */
export const DATA_IMPORTER_ACTIVATION_EVENT = 'onPositronDataExplorerImport';

/**
 * The declarative half of an importer: what it is called, what language its code is written in, and
 * which file extensions it can read. Extensions cannot read every format (base R cannot read XLSX),
 * so the extension list is what keeps unusable options off the offer.
 */
export interface IDataImporterMetadata {
	/** The language the generated code is written in, e.g. 'python'. */
	readonly languageId: string;

	/** A human-readable name for the importer, e.g. 'Python (pandas)'. */
	readonly displayName: string;

	/** File extensions this importer can read, without a leading dot, e.g. ['csv', 'tsv']. */
	readonly fileExtensions: readonly string[];

	/**
	 * Words this importer's language will not let you assign to, e.g. 'class' for Python or 'if'
	 * for R. Positron suffixes a derived default that collides with one, so an importer that omits
	 * the list gets 'class = ...' offered for a file named class.csv.
	 */
	readonly reservedNames?: readonly string[];
}

/**
 * Import options that are not part of the file's identity. This bag is the seam for future options
 * (delimiter, skip rows, NA strings, column types, encoding); today only the two below exist.
 */
export interface IDataImportOptions {
	/** Whether the first row holds column names. Defaults to true when absent. */
	readonly hasHeaderRow?: boolean;

	/** The worksheet to read, for formats that have sheets. */
	readonly sheetName?: string;
}

/**
 * A column sort from the Data Explorer view. The column is named rather than indexed, because the
 * generated code operates on the loaded dataframe, where names are the only stable handle.
 */
export interface IDataImportSortKey {
	/** The name of the column to sort by. */
	readonly columnName: string;

	/** Sort order: ascending (true) or descending (false). */
	readonly ascending: boolean;
}

/** The fields every row filter carries, whatever its type. */
export interface IDataImportRowFilterBase {
	/** The name of the column the filter applies to. */
	readonly columnName: string;

	/** The column's canonical Positron display type, e.g. 'integer', 'string', 'boolean'. */
	readonly columnType: string;

	/** How this filter combines with the one before it. Ignored on the first filter. */
	readonly condition: 'and' | 'or';
}

/** Keeps rows where the column's value falls inside (or, for not_between, outside) a range. */
export interface IDataImportBetweenFilter extends IDataImportRowFilterBase {
	readonly filterType: 'between' | 'not_between';
	/** The lower limit, as a stringified column value. */
	readonly leftValue: string;
	/** The upper limit, as a stringified column value. */
	readonly rightValue: string;
}

/** Keeps rows satisfying a binary comparison against one value. */
export interface IDataImportCompareFilter extends IDataImportRowFilterBase {
	readonly filterType: 'compare';
	readonly op: '=' | '!=' | '<' | '<=' | '>' | '>=';
	/** The comparison value, as a stringified column value. */
	readonly value: string;
}

/** Keeps rows whose text matches a search term. */
export interface IDataImportSearchFilter extends IDataImportRowFilterBase {
	readonly filterType: 'search';
	readonly searchType: 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'regex_match';
	readonly term: string;
	readonly caseSensitive: boolean;
}

/** Keeps rows whose value is in (or, when not inclusive, not in) a set. */
export interface IDataImportSetMembershipFilter extends IDataImportRowFilterBase {
	readonly filterType: 'set_membership';
	/** The set members, as stringified column values. */
	readonly values: string[];
	readonly inclusive: boolean;
}

/** A row filter that needs no parameters beyond its type. */
export interface IDataImportUnaryFilter extends IDataImportRowFilterBase {
	readonly filterType: 'is_null' | 'not_null' | 'is_empty' | 'not_empty' | 'is_true' | 'is_false';
}

/**
 * One row filter from the Data Explorer view, discriminated on filterType so a generator can
 * switch over it exhaustively and route any type it cannot translate to `unsupported`.
 */
export type IDataImportRowFilter =
	| IDataImportBetweenFilter
	| IDataImportCompareFilter
	| IDataImportSearchFilter
	| IDataImportSetMembershipFilter
	| IDataImportUnaryFilter;

/**
 * The Data Explorer view at the moment the dialog opened: what the user is looking at beyond the
 * raw file. Row filters marked invalid by the backend are excluded, because they are not applied
 * to the on-screen data either.
 */
export interface IDataImportView {
	readonly rowFilters: IDataImportRowFilter[];
	readonly sortKeys: IDataImportSortKey[];
}

/**
 * A request to generate the code that loads one file into one variable.
 */
export interface IDataImportRequest {
	/** The original file, not the positron-data-explorer URI. */
	readonly fileUri: URI;

	/**
	 * The target variable name. Positron's derived default is always assignable, but the user is
	 * free to replace it with anything, so an importer should embed this as given rather than
	 * assume it parses.
	 */
	readonly variableName: string;

	/** Format and parsing options. */
	readonly options: IDataImportOptions;

	/**
	 * The Data Explorer view to reproduce, present only when the user asked to include the
	 * current filters and sorts. A generator that cannot translate part of it reports that part
	 * in `unsupported` rather than dropping it silently.
	 */
	readonly view?: IDataImportView;
}

/**
 * The wire form of {@link IDataImportRequest}, sent to the extension host.
 */
export interface IDataImportRequestDto {
	readonly fileUri: UriComponents;
	readonly variableName: string;
	readonly options: IDataImportOptions;

	/**
	 * The Data Explorer view to reproduce, present only when the user asked to include the
	 * current filters and sorts. A generator that cannot translate part of it reports that part
	 * in `unsupported` rather than dropping it silently.
	 */
	readonly view?: IDataImportView;
}

/**
 * Generated code, plus anything the importer could not express. Silently dropping a filter would
 * hand someone a different dataframe than the one on screen, so the omissions travel with the code.
 */
export interface IDataImportResult {
	/** The generated code, ready to run in a console. */
	readonly code: string;

	/** Human-readable descriptions of anything in the request the importer could not translate. */
	readonly unsupported?: string[];
}

/**
 * A registered importer: its metadata plus its code generator.
 */
export interface IDataImporter extends IDataImporterMetadata {
	/**
	 * Generates the code that loads the requested file.
	 * @param request The file, target variable name, and options.
	 * @returns The generated code, or undefined if the importer declined to generate any.
	 */
	generateCode(request: IDataImportRequest): Promise<IDataImportResult | undefined>;
}

export const IPositronDataImporterRegistry = createDecorator<IPositronDataImporterRegistry>('positronDataImporterRegistry');

/**
 * Holds the data importers contributed by extensions, queryable by file extension.
 */
export interface IPositronDataImporterRegistry {
	readonly _serviceBrand: undefined;

	/**
	 * Registers an importer.
	 * @param importer The importer to register.
	 * @returns A disposable that unregisters it.
	 */
	registerImporter(importer: IDataImporter): IDisposable;

	/**
	 * Returns the importers that can read a file extension, sorted by display name. Activates
	 * contributing extensions first, so a dormant extension's importer is not missed.
	 * @param fileExtension The extension to match, with or without a leading dot; case-insensitive.
	 */
	getImporters(fileExtension: string): Promise<IDataImporter[]>;
}
