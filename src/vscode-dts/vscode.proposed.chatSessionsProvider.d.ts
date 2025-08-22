/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	/**
	 * Provides a list of information about chat sessions.
	 */
	export interface ChatSessionItemProvider {
		/**
		 * Event that the provider can fire to signal that chat sessions have changed.
		 */
		readonly onDidChangeChatSessionItems: Event<void>;

		// /**
		//  * Create a new chat session item
		//  */
		// provideNewChatSessionItem(context: {
		// 	// This interface should be extracted
		// 	readonly triggerChat?: {
		// 		readonly prompt: string;
		// 		readonly history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn>;
		// 	};
		// }, token: CancellationToken): Thenable<ChatSessionItem> | ChatSessionItem;

		/**
		 * Provides a list of chat sessions.
		 */
		// TODO: Do we need a flag to try auth if needed?
		provideChatSessionItems(token: CancellationToken): ProviderResult<ChatSessionItem[]>;
	}

	export interface ChatSessionItem {
		/**
		 * Unique identifier for the chat session.
		 */
		id: string;

		/**
		 * Human readable name of the session shown in the UI
		 */
		label: string;

		/**
		 * An icon for the participant shown in UI.
		 */
		iconPath?: IconPath;
	}

	export interface ChatSession {

		/**
		 * The full history of the session
		 *
		 * This should not include any currently active responses
		 */
		// TODO: Are these the right types to use?
		// TODO: link request + response to encourage correct usage?
		readonly history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn2>;

		/**
		 * Callback invoked by the editor for a currently running response. This allows the session to push items for the
		 * current response and stream these in as them come in. The current response will be considered complete once the
		 * callback resolved.
		 *
		 * If not provided, the chat session is assumed to not currently be running.
		 */
		readonly activeResponseCallback?: (stream: ChatResponseStream, token: CancellationToken) => Thenable<void>;

		/**
		 * Handles new request for the session.
		 *
		 * If not set, then the session will be considered read-only and no requests can be made.
		 */
		// TODO: Should we introduce our own type for `ChatRequestHandler` since not all field apply to chat sessions?
		readonly requestHandler: ChatRequestHandler | undefined;
	}

	export interface ChatSessionContentProvider {
		/**
		 * Resolves a chat session into a full `ChatSession` object.
		 *
		 * @param sessionId The id of the chat session to open.
		 * @param token A cancellation token that can be used to cancel the operation.
		 */
		provideChatSessionContent(sessionId: string, token: CancellationToken): Thenable<ChatSession> | ChatSession;
	}

	export namespace chat {
		/**
		 * Registers a new {@link ChatSessionItemProvider chat session item provider}.
		 *
		 * To use this, also make sure to also add `chatSessions` contribution in the `package.json`.
		 *
		 * @param chatSessionType The type of chat session the provider is for.
		 * @param provider The provider to register.
		 *
		 * @returns A disposable that unregisters the provider when disposed.
		 */
		export function registerChatSessionItemProvider(chatSessionType: string, provider: ChatSessionItemProvider): Disposable;

		/**
		 * Registers a new {@link ChatSessionContentProvider chat session content provider}.
		 *
		 * @param chatSessionType A unique identifier for the chat session type. This is used to differentiate between different chat session providers.
		 * @param provider The provider to register.
		 *
		 * @returns A disposable that unregisters the provider when disposed.
		 */
		export function registerChatSessionContentProvider(chatSessionType: string, provider: ChatSessionContentProvider): Disposable;
	}

	export interface ChatSessionShowOptions {
		/**
		 * The editor view column to show the chat session in.
		 *
		 * If not provided, the chat session will be shown in the chat panel instead.
		 */
		readonly viewColumn?: ViewColumn;
	}

	export namespace window {
		/**
		 * Shows a chat session in the panel or editor.
		 */
		export function showChatSession(chatSessionType: string, sessionId: string, options: ChatSessionShowOptions): Thenable<void>;
	}
}
