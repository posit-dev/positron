/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CodeAttributionSource, getAgentAttribution } from '../../common/positronConsoleCodeExecution.js';

describe('getAgentAttribution', () => {
	const revealCommand = { command: 'posit-assistant.revealMessage', arguments: [{ conversationId: 'c', messageId: 'm' }] };

	it('names an external agent from its metadata, with nothing to reveal', () => {
		expect(getAgentAttribution({
			source: CodeAttributionSource.Agent,
			metadata: { agentName: 'Claude Code', tool: 'execute_code' },
		})).toEqual({ name: 'Claude Code', revealCommand: undefined });
	});

	it('falls back to a generic name for an unnamed external agent', () => {
		expect(getAgentAttribution({ source: CodeAttributionSource.Agent })?.name).toBe('External agent');
	});

	it('names an extension agent and keeps its reveal command', () => {
		expect(getAgentAttribution({
			source: CodeAttributionSource.Extension,
			metadata: { extensionId: 'posit.assistant', agentName: 'Posit Assistant', revealCommand },
		})).toEqual({ name: 'Posit Assistant', revealCommand });
	});

	it('drops a malformed reveal command', () => {
		expect(getAgentAttribution({
			source: CodeAttributionSource.Extension,
			metadata: { agentName: 'Posit Assistant', revealCommand: { command: 'x', arguments: 'y' } },
		})?.revealCommand).toBeUndefined();
	});

	it('does not credit an agent for extension code without an agent name', () => {
		expect(getAgentAttribution({ source: CodeAttributionSource.Extension, metadata: { extensionId: 'x' } })).toBeUndefined();
	});

	it('does not credit an agent for code the user chose to run', () => {
		expect(getAgentAttribution({
			source: CodeAttributionSource.Assistant,
			metadata: { agentName: 'Posit Assistant', userInitiated: true },
		})).toBeUndefined();
	});
});
