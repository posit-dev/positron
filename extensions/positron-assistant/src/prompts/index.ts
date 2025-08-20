/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Core infrastructure
export { PromptRenderer } from '../promptRenderer';

// Base components
export { ActivationSteering } from './components/base/ActivationSteering';

// Content components
export { DefaultContent, AgentContent, EditorContent, TerminalContent, FilepathsContent, AttachmentsContent, FollowupsContent, SessionsContent, EditorStreamingContent, SelectionStreamingContent, SelectionContent, QuartoContent, MapEditContent, Attachment, Session, type AttachmentData, type SessionData, type IHistorySummaryEntry } from './components/content';

// Language-specific components
export { LanguageInstructions } from './components/language/LanguageInstructions';

// Participant-specific prompts
export { ChatPrompt } from './participants/ChatPrompt';
export { AgentPrompt } from './participants/AgentPrompt';
export { TerminalPrompt } from './participants/TerminalPrompt';
export { EditorPrompt } from './participants/EditorPrompt';
export { UnifiedPrompt } from './participants/UnifiedPrompt';
