/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Names (IDs) of the language model tools contributed by Positron Assistant.
 *
 * These string values are the public tool identifiers surfaced to chat clients
 * (e.g. Copilot Chat), so they must stay stable and match any extension that
 * still references them.
 */
export enum PositronAssistantToolName {
	ExecuteCode = 'executeCode',
	GetTableSummary = 'getTableSummary',
	GetPlot = 'getPlot',
	InspectVariables = 'inspectVariables',
}

/**
 * Tag applied to every Positron Assistant tool. Used by chat clients to
 * identify tools that belong to Positron.
 */
export const POSITRON_ASSISTANT_TOOL_TAG = 'positron-assistant';

/**
 * Tag marking a tool that only makes sense when a runtime session is active.
 */
export const TOOL_TAG_REQUIRES_SESSION = 'requires-session';
