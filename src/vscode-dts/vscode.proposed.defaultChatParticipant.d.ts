/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export type ChatWelcomeMessageContent = string | MarkdownString;

	export interface ChatWelcomeMessageProvider {
		provideWelcomeMessage(location: ChatLocation, token: CancellationToken): ProviderResult<ChatWelcomeMessageContent[]>;
		provideSampleQuestions?(location: ChatLocation, token: CancellationToken): ProviderResult<ChatFollowup[]>;
	}

	export interface ChatRequesterInformation {
		name: string;

		/**
		 * A full URI for the icon of the request.
		 */
		icon?: Uri;
	}

	export interface ChatParticipant {
		/**
		 * When true, this participant is invoked by default when no other participant is being invoked
		 */
		isDefault?: boolean;

		/**
		 * When true, this participant is invoked when the user submits their query using ctrl/cmd+enter
		 * TODO@API name
		 */
		isSecondary?: boolean;

		/**
		 * A string that will be added before the listing of chat participants in `/help`.
		 */
		helpTextPrefix?: string | MarkdownString;

		/**
		 * A string that will be added before the listing of chat variables in `/help`.
		 */
		helpTextVariablesPrefix?: string | MarkdownString;

		/**
		 * A string that will be appended after the listing of chat participants in `/help`.
		 */
		helpTextPostfix?: string | MarkdownString;

		welcomeMessageProvider?: ChatWelcomeMessageProvider;
		requester?: ChatRequesterInformation;
	}
}
