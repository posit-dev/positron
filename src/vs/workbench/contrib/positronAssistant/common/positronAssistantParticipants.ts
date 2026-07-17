/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Identifiers of the chat participants contributed by Positron Assistant.
 *
 * These string values are the public participant ids; tool filtering keys off
 * them to decide which tools are available in each participant/mode.
 */
export enum ParticipantID {
	/** The participant used in the chat pane in Ask mode. */
	Chat = 'positron.assistant.chat',

	/** The participant used in the chat pane in Edit mode. */
	Edit = 'positron.assistant.editingSessionEditor',

	/** The participant used in the chat pane in Agent mode. */
	Agent = 'positron.assistant.agent',

	/** The participant used in editor inline chats. */
	Editor = 'positron.assistant.editor',

	/** The participant used in terminal inline chats. */
	Terminal = 'positron.assistant.terminal',
}
