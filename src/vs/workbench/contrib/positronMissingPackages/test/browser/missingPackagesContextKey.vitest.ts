/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter, Event } from '../../../../../base/common/event.js';
import { IContextKey, IContextKeyService, ContextKeyValue } from '../../../../../platform/contextkey/common/contextkey.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, ILanguageRuntimeSessionStateEvent, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { activeEditorSupportsMissingPackages, MISSING_PACKAGES_SUPPORTED_KEY, MissingPackagesContextKeyContribution } from '../../browser/missingPackagesContextKey.js';

describe('activeEditorSupportsMissingPackages', () => {
	const sessionWithCapability = stubInterface<ILanguageRuntimeSession>({ listMissingPackages: async () => [] });
	const sessionWithoutCapability = stubInterface<ILanguageRuntimeSession>({ listMissingPackages: undefined });

	it('is false when there is no active language', () => {
		expect(activeEditorSupportsMissingPackages(undefined, undefined)).toBe(false);
	});

	it('is true for a Quarto document regardless of session', () => {
		expect(activeEditorSupportsMissingPackages('quarto', undefined)).toBe(true);
	});

	it('is true when the active language has a session that supports missing packages', () => {
		expect(activeEditorSupportsMissingPackages('anything', sessionWithCapability)).toBe(true);
	});

	it('is false when the active language session does not support missing packages', () => {
		expect(activeEditorSupportsMissingPackages('anything', sessionWithoutCapability)).toBe(false);
	});
});

describe('MissingPackagesContextKeyContribution', () => {
	const onDidActiveEditorChange = new Emitter<void>();
	const onDidStartRuntime = new Emitter<ILanguageRuntimeSession>();
	const onDidFailStartRuntime = new Emitter<ILanguageRuntimeSession>();
	const onDidChangeRuntimeState = new Emitter<ILanguageRuntimeSessionStateEvent>();
	const onDidChangeForegroundSession = new Emitter<ILanguageRuntimeSession | undefined>();
	const onDidDeleteRuntimeSession = new Emitter<string>();

	const sessionWithCapability = stubInterface<ILanguageRuntimeSession>({
		sessionId: 'julia-session',
		listMissingPackages: async () => [],
	});

	let activeLanguageId: string | undefined;
	let activeSession: ILanguageRuntimeSession | undefined;
	let supported: boolean | undefined;

	const ctx = createTestContainer()
		.stub(IContextKeyService, {
			onDidChangeContext: Event.None,
			bufferChangeEvents: (callback: () => void) => callback(),
			createKey: <T extends ContextKeyValue>(key: string, defaultValue: T | undefined): IContextKey<T> => {
				let value = defaultValue;
				if (key === MISSING_PACKAGES_SUPPORTED_KEY.key && typeof defaultValue === 'boolean') {
					supported = defaultValue;
				}
				return {
					set: newValue => {
						value = newValue;
						if (key === MISSING_PACKAGES_SUPPORTED_KEY.key && typeof newValue === 'boolean') {
							supported = newValue;
						}
					},
					reset: () => {
						value = defaultValue;
						if (key === MISSING_PACKAGES_SUPPORTED_KEY.key && typeof defaultValue === 'boolean') {
							supported = defaultValue;
						}
					},
					get: () => value,
				};
			},
			getContextKeyValue: () => supported,
		})
		.stub(IEditorService, {
			get activeTextEditorLanguageId() {
				return activeLanguageId;
			},
			onDidActiveEditorChange: onDidActiveEditorChange.event,
		})
		.stub(IRuntimeSessionService, {
			onDidStartRuntime: onDidStartRuntime.event,
			onDidFailStartRuntime: onDidFailStartRuntime.event,
			onDidChangeRuntimeState: onDidChangeRuntimeState.event,
			onDidChangeForegroundSession: onDidChangeForegroundSession.event,
			onDidDeleteRuntimeSession: onDidDeleteRuntimeSession.event,
			getConsoleSessionForLanguage: () => activeSession,
		})
		.build();

	beforeEach(() => {
		activeLanguageId = 'julia';
		activeSession = sessionWithCapability;
		supported = undefined;
	});

	function createContribution(): MissingPackagesContextKeyContribution {
		return ctx.disposables.add(ctx.instantiationService.createInstance(MissingPackagesContextKeyContribution));
	}

	it('updates when the active session is deleted', () => {
		createContribution();
		expect(supported).toBe(true);

		activeSession = undefined;
		onDidDeleteRuntimeSession.fire('julia-session');

		expect(supported).toBe(false);
	});

	it('updates when the active editor language changes', () => {
		activeLanguageId = undefined;
		activeSession = undefined;
		createContribution();
		expect(supported).toBe(false);

		activeLanguageId = 'julia';
		activeSession = sessionWithCapability;
		onDidActiveEditorChange.fire();
		expect(supported).toBe(true);

		activeLanguageId = 'plaintext';
		activeSession = undefined;
		onDidActiveEditorChange.fire();
		expect(supported).toBe(false);
	});

	it('updates when the foreground session changes', () => {
		activeSession = undefined;
		createContribution();
		expect(supported).toBe(false);

		activeSession = sessionWithCapability;
		onDidChangeForegroundSession.fire(sessionWithCapability);
		expect(supported).toBe(true);

		activeSession = undefined;
		onDidChangeForegroundSession.fire(undefined);
		expect(supported).toBe(false);
	});

	it('updates when the active session changes runtime state or fails startup', () => {
		createContribution();
		expect(supported).toBe(true);

		activeSession = undefined;
		onDidChangeRuntimeState.fire({
			session_id: 'julia-session',
			old_state: RuntimeState.Ready,
			new_state: RuntimeState.Exited,
		});
		expect(supported).toBe(false);

		activeSession = sessionWithCapability;
		onDidStartRuntime.fire(sessionWithCapability);
		expect(supported).toBe(true);

		activeSession = undefined;
		onDidFailStartRuntime.fire(sessionWithCapability);
		expect(supported).toBe(false);
	});
});
