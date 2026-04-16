/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter, Event } from '../../base/common/event.js';
import { ICodeEditorService } from '../../editor/browser/services/codeEditorService.js';
import { INotebookEditorService } from '../../workbench/contrib/notebook/browser/services/notebookEditorService.js';
import { IPositronNotebookService } from '../../workbench/contrib/positronNotebook/browser/positronNotebookService.js';
import { createTestContainer } from './positronTestContainer.js';

describe('positronTestContainer', () => {

	describe('withReactServices', () => {
		const ctx = createTestContainer().withReactServices().build();

		it('creates a PositronReactServices instance without throwing', () => {
			// This test catches stale stub lists. If a new service is added
			// to PositronReactServices but not stubbed in the ReactServices
			// layer, createInstance() will throw with the missing service name.
			let services;
			try {
				services = ctx.reactServices;
			} catch (e) {
				throw new Error(
					`withReactServices() is missing a stub. If you added a service to ` +
					`PositronReactServices (src/vs/base/browser/positronReactServices.tsx), ` +
					`add a matching stub in src/vs/test/vitest/presets/reactServices.ts.\n\n` +
					`Original error: ${e}`
				);
			}
			expect(services).toBeDefined();
		});
	});

	describe('withContributionServices', () => {
		const ctx = createTestContainer().withContributionServices().build();

		it('stubs editor/notebook lifecycle events with Event.None', () => {
			expect(ctx.get(INotebookEditorService).onDidAddNotebookEditor).toBe(Event.None);
			expect(ctx.get(ICodeEditorService).onCodeEditorAdd).toBe(Event.None);
			expect(ctx.get(IPositronNotebookService).onDidAddNotebookInstance).toBe(Event.None);
		});
	});

	describe('withReactServices + withContributionServices (stackable)', () => {
		const ctx = createTestContainer()
			.withReactServices()
			.withContributionServices()
			.build();

		it('exposes ctx.reactServices from the React layer', () => {
			expect(ctx.reactServices).toBeDefined();
		});

		it('also applies contribution-service stubs from the Contribution layer', () => {
			expect(ctx.get(INotebookEditorService).onDidAddNotebookEditor).toBe(Event.None);
			expect(ctx.get(IPositronNotebookService).onDidAddNotebookInstance).toBe(Event.None);
		});
	});

	describe('withContributionServices + withReactServices (reversed order)', () => {
		// Proves layer order does not matter.
		const ctx = createTestContainer()
			.withContributionServices()
			.withReactServices()
			.build();

		it('still exposes ctx.reactServices', () => {
			expect(ctx.reactServices).toBeDefined();
		});

		it('still applies contribution-service stubs', () => {
			expect(ctx.get(INotebookEditorService).onDidAddNotebookEditor).toBe(Event.None);
		});
	});

	describe('user .stub() overrides preset stubs', () => {
		// Use a real Emitter so customEvent is a distinct reference from the
		// Event.None that the Contribution layer stubs in. If we used a value
		// equal to Event.None, toBe(customEvent) would pass even if the
		// override mechanism were broken.
		const customEmitter = new Emitter<void>();
		const customEvent = customEmitter.event;
		const ctx = createTestContainer()
			.withContributionServices()
			.stub(INotebookEditorService, { onDidAddNotebookEditor: customEvent })
			.build();

		it('user .stub() wins over the Contribution layer', () => {
			const resolved = ctx.get(INotebookEditorService).onDidAddNotebookEditor;
			expect(resolved).toBe(customEvent);
			expect(resolved).not.toBe(Event.None);
			ctx.disposables.add(customEmitter);
		});
	});
});
