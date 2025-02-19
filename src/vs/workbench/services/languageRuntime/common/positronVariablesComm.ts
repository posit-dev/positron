/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from variables.json; do not edit.
//

import { Event } from '../../../../base/common/event.js';
import { PositronBaseComm, PositronCommOptions } from './positronBaseComm.js';
import { IRuntimeClientInstance } from './languageRuntimeClientInstance.js';

/**
 * A view containing a list of variables in the session.
 */
export interface VariableList {
	/**
	 * A list of variables in the session.
	 */
	variables: Array<Variable>;

	/**
	 * The total number of variables in the session. This may be greater than
	 * the number of variables in the 'variables' array if the array is
	 * truncated.
	 */
	length: number;

	/**
	 * The version of the view (incremented with each update)
	 */
	version?: number;

}

/**
 * An inspected variable.
 */
export interface InspectedVariable {
	/**
	 * The children of the inspected variable.
	 */
	children: Array<Variable>;

	/**
	 * The total number of children. This may be greater than the number of
	 * children in the 'children' array if the array is truncated.
	 */
	length: number;

}

/**
 * An object formatted for copying to the clipboard.
 */
export interface FormattedVariable {
	/**
	 * The formatted content of the variable.
	 */
	content: string;

}

/**
 * A single variable in the runtime.
 */
export interface Variable {
	/**
	 * A key that uniquely identifies the variable within the runtime and can
	 * be used to access the variable in `inspect` requests
	 */
	access_key: string;

	/**
	 * The name of the variable, formatted for display
	 */
	display_name: string;

	/**
	 * A string representation of the variable's value, formatted for display
	 * and possibly truncated
	 */
	display_value: string;

	/**
	 * The variable's type, formatted for display
	 */
	display_type: string;

	/**
	 * Extended information about the variable's type
	 */
	type_info: string;

	/**
	 * The size of the variable's value in bytes
	 */
	size: number;

	/**
	 * The kind of value the variable represents, such as 'string' or
	 * 'number'
	 */
	kind: VariableKind;

	/**
	 * The number of elements in the variable, if it is a collection
	 */
	length: number;

	/**
	 * Whether the variable has child variables
	 */
	has_children: boolean;

	/**
	 * True if there is a viewer available for this variable (i.e. the
	 * runtime can handle a 'view' request for this variable)
	 */
	has_viewer: boolean;

	/**
	 * True if the 'value' field is a truncated representation of the
	 * variable's value
	 */
	is_truncated: boolean;

	/**
	 * The time the variable was created or updated, in milliseconds since
	 * the epoch, or 0 if unknown.
	 */
	updated_time: number;

}

/**
 * Possible values for Format in ClipboardFormat
 */
export enum ClipboardFormatFormat {
	TextHtml = 'text/html',
	TextPlain = 'text/plain'
}

/**
 * Possible values for Kind in Variable
 */
export enum VariableKind {
	Boolean = 'boolean',
	Bytes = 'bytes',
	Class = 'class',
	Collection = 'collection',
	Empty = 'empty',
	Function = 'function',
	Map = 'map',
	Number = 'number',
	Other = 'other',
	String = 'string',
	Table = 'table',
	Lazy = 'lazy',
	Connection = 'connection'
}

/**
 * Parameters for the Clear method.
 */
export interface ClearParams {
	/**
	 * Whether to clear hidden objects in addition to normal variables
	 */
	include_hidden_objects: boolean;
}

/**
 * Parameters for the Delete method.
 */
export interface DeleteParams {
	/**
	 * The names of the variables to delete.
	 */
	names: Array<string>;
}

/**
 * Parameters for the Inspect method.
 */
export interface InspectParams {
	/**
	 * The path to the variable to inspect, as an array of access keys.
	 */
	path: Array<string>;
}

/**
 * Parameters for the ClipboardFormat method.
 */
export interface ClipboardFormatParams {
	/**
	 * The path to the variable to format, as an array of access keys.
	 */
	path: Array<string>;

	/**
	 * The requested format for the variable, as a MIME type
	 */
	format: ClipboardFormatFormat;
}

/**
 * Parameters for the View method.
 */
export interface ViewParams {
	/**
	 * The path to the variable to view, as an array of access keys.
	 */
	path: Array<string>;
}

/**
 * Parameters for the Update method.
 */
export interface UpdateParams {
	/**
	 * An array of variables that have been newly assigned.
	 */
	assigned: Array<Variable>;

	/**
	 * An array of variables that were not evaluated for value updates.
	 */
	unevaluated: Array<Variable>;

	/**
	 * An array of variable names that have been removed.
	 */
	removed: Array<string>;

	/**
	 * The version of the view (incremented with each update), or 0 if the
	 * backend doesn't track versions.
	 */
	version: number;
}

/**
 * Parameters for the Refresh method.
 */
export interface RefreshParams {
	/**
	 * An array listing all the variables in the current session.
	 */
	variables: Array<Variable>;

	/**
	 * The number of variables in the current session.
	 */
	length: number;

	/**
	 * The version of the view (incremented with each update), or 0 if the
	 * backend doesn't track versions.
	 */
	version: number;
}

/**
 * Event: Update variables
 */
export interface UpdateEvent {
	/**
	 * An array of variables that have been newly assigned.
	 */
	assigned: Array<Variable>;

	/**
	 * An array of variables that were not evaluated for value updates.
	 */
	unevaluated: Array<Variable>;

	/**
	 * An array of variable names that have been removed.
	 */
	removed: Array<string>;

	/**
	 * The version of the view (incremented with each update), or 0 if the
	 * backend doesn't track versions.
	 */
	version: number;

}

/**
 * Event: Refresh variables
 */
export interface RefreshEvent {
	/**
	 * An array listing all the variables in the current session.
	 */
	variables: Array<Variable>;

	/**
	 * The number of variables in the current session.
	 */
	length: number;

	/**
	 * The version of the view (incremented with each update), or 0 if the
	 * backend doesn't track versions.
	 */
	version: number;

}

export enum VariablesFrontendEvent {
	Update = 'update',
	Refresh = 'refresh'
}

export enum VariablesBackendRequest {
	List = 'list',
	Clear = 'clear',
	Delete = 'delete',
	Inspect = 'inspect',
	ClipboardFormat = 'clipboard_format',
	View = 'view'
}

export class PositronVariablesComm extends PositronBaseComm {
	constructor(
		instance: IRuntimeClientInstance<any, any>,
		options?: PositronCommOptions<VariablesBackendRequest>,
	) {
		super(instance, options);
		this.onDidUpdate = super.createEventEmitter('update', ['assigned', 'unevaluated', 'removed', 'version']);
		this.onDidRefresh = super.createEventEmitter('refresh', ['variables', 'length', 'version']);
	}

	/**
	 * List all variables
	 *
	 * Returns a list of all the variables in the current session.
	 *
	 *
	 * @returns A view containing a list of variables in the session.
	 */
	list(): Promise<VariableList> {
		return super.performRpc('list', [], []);
	}

	/**
	 * Clear all variables
	 *
	 * Clears (deletes) all variables in the current session.
	 *
	 * @param includeHiddenObjects Whether to clear hidden objects in
	 * addition to normal variables
	 *
	 */
	clear(includeHiddenObjects: boolean): Promise<void> {
		return super.performRpc('clear', ['include_hidden_objects'], [includeHiddenObjects]);
	}

	/**
	 * Deletes a set of named variables
	 *
	 * Deletes the named variables from the current session.
	 *
	 * @param names The names of the variables to delete.
	 *
	 * @returns The names of the variables that were successfully deleted.
	 */
	delete(names: Array<string>): Promise<Array<string>> {
		return super.performRpc('delete', ['names'], [names]);
	}

	/**
	 * Inspect a variable
	 *
	 * Returns the children of a variable, as an array of variables.
	 *
	 * @param path The path to the variable to inspect, as an array of access
	 * keys.
	 *
	 * @returns An inspected variable.
	 */
	inspect(path: Array<string>): Promise<InspectedVariable> {
		return super.performRpc('inspect', ['path'], [path]);
	}

	/**
	 * Format for clipboard
	 *
	 * Requests a formatted representation of a variable for copying to the
	 * clipboard.
	 *
	 * @param path The path to the variable to format, as an array of access
	 * keys.
	 * @param format The requested format for the variable, as a MIME type
	 *
	 * @returns An object formatted for copying to the clipboard.
	 */
	clipboardFormat(path: Array<string>, format: ClipboardFormatFormat): Promise<FormattedVariable> {
		return super.performRpc('clipboard_format', ['path', 'format'], [path, format]);
	}

	/**
	 * Request a viewer for a variable
	 *
	 * Request that the runtime open a data viewer to display the data in a
	 * variable.
	 *
	 * @param path The path to the variable to view, as an array of access
	 * keys.
	 *
	 * @returns The ID of the viewer that was opened.
	 */
	view(path: Array<string>): Promise<string> {
		return super.performRpc('view', ['path'], [path]);
	}


	/**
	 * Update variables
	 *
	 * Updates the variables in the current session.
	 */
	onDidUpdate: Event<UpdateEvent>;
	/**
	 * Refresh variables
	 *
	 * Replace all variables in the current session with the variables from
	 * the backend.
	 */
	onDidRefresh: Event<RefreshEvent>;
}

