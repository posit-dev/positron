/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/nextEditSuggestions.css';
import { $, append, clearNode, EventType, addDisposableListener, EventHelper, disposableWindowInterval, getWindow } from '../../../../base/browser/dom.js';
import { Gesture, EventType as TouchEventType } from '../../../../base/browser/touch.js';
import { ActionBar } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { Checkbox } from '../../../../base/browser/ui/toggle/toggle.js';
import { renderLabelWithIcons } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { toAction } from '../../../../base/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { parseLinkedText } from '../../../../base/common/linkedText.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { isObject } from '../../../../base/common/types.js';
import { IInlineCompletionsService } from '../../../../editor/browser/services/inlineCompletionsService.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IHoverService, nativeHoverDelegate } from '../../../../platform/hover/browser/hover.js';
import { Link } from '../../../../platform/opener/browser/link.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { defaultButtonStyles, defaultCheckboxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { DomWidget } from '../../../../platform/domWidget/browser/domWidget.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';

/** Setting controlling which file types receive next edit suggestions. */
export const NES_ENABLE_SETTING = 'nextEditSuggestions.enabled';

/** Context key (owned by the extension) gating whether the status item is shown at all. */
export const NES_CONTEXT_AVAILABLE = 'nextEditSuggestions.available';

/** Context key (owned by the extension) that is true when signed in to Posit AI. */
export const NES_CONTEXT_SIGNED_IN = 'nextEditSuggestions.signedIn';

/**
 * Context key (owned by the extension) that is true when Next Edit Suggestions
 * is fully operational: AI is enabled, the feature is on for at least one file
 * type, and the user is signed in. Distinct from {@link NES_CONTEXT_SIGNED_IN},
 * which reflects auth alone.
 */
export const NES_CONTEXT_ACTIVE = 'nextEditSuggestions.active';

/** Context key (owned by the extension) holding the name of the provider that powers suggestions. */
export const NES_CONTEXT_PROVIDER = 'nextEditSuggestions.provider';

/** Context key (owned by the extension) holding the model the LSP uses. */
export const NES_CONTEXT_MODEL = 'nextEditSuggestions.model';

/** Context key (owned by the extension) that is true while a completion request is in flight. */
export const NES_CONTEXT_BUSY = 'nextEditSuggestions.busy';

/**
 * Context key (owned by the extension) that is true when next edit suggestions are enabled for the active file.
 */
export const NES_CONTEXT_FILE_ENABLED = 'nextEditSuggestions.fileEnabled';

/** Command (owned by the authentication extension) that opens the Configure Language Model Providers modal. */
const CONFIGURE_PROVIDERS_COMMAND = 'authentication.configureProviders';

/** Shape of the {@link NES_CONTEXT_MODEL} context key value. */
interface INextEditSuggestionsModel {
	readonly id: string;
	readonly displayName: string;
}

/**
 * Reads whether next edit suggestions are enabled for the given language.
 * When no `languageId` is given, the `*` wildcard value is returned.
 */
export function isNextEditSuggestionsEnabled(configurationService: IConfigurationService, languageId?: string): boolean {
	const enable = configurationService.getValue<Record<string, boolean>>(NES_ENABLE_SETTING);
	if (!isObject(enable)) {
		return true;
	}
	if (languageId && Object.hasOwn(enable, languageId)) {
		return enable[languageId];
	}
	return enable['*'] ?? true;
}

/**
 * Writes the enablement for a single key (language id or `*`)
 * into `nextEditSuggestions.enabled`.
 * */
export function setNextEditSuggestionsEnabled(configurationService: IConfigurationService, key: string, value: boolean): Promise<void> {
	let current = configurationService.getValue<Record<string, boolean>>(NES_ENABLE_SETTING);
	if (!isObject(current)) {
		current = Object.create(null);
	}
	return configurationService.updateValue(NES_ENABLE_SETTING, { ...current, [key]: value });
}

/**
 * The hover popover for the Next Edit Suggestions status bar item: the
 * file-type checkboxes drive `nextEditSuggestions.enabled`, and the Snooze
 * button reuses the global inline completions snooze.
 */
export class NextEditSuggestionsStatusDashboard extends DomWidget {

	readonly element = $('div.next-edit-suggestions-status-tooltip');

	private readonly contentDisposables = this._store.add(new MutableDisposable<DisposableStore>());

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorService private readonly editorService: IEditorService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IInlineCompletionsService private readonly inlineCompletionsService: IInlineCompletionsService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@ICommandService private readonly commandService: ICommandService,
		@IHoverService private readonly hoverService: IHoverService,
		@IOpenerService private readonly openerService: IOpenerService,
	) {
		super();

		this._store.add(this.contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(new Set([NES_CONTEXT_SIGNED_IN, NES_CONTEXT_PROVIDER, NES_CONTEXT_MODEL]))) {
				this.renderContents();
			}
		}));

		this.renderContents();
	}

	private renderContents(): void {
		const disposables = this.contentDisposables.value = new DisposableStore();
		clearNode(this.element);

		const signedIn = this.contextKeyService.getContextKeyValue<boolean>(NES_CONTEXT_SIGNED_IN) ?? false;

		this.createHeader(this.element, localize('positron.nes.title', "Next Edit Suggestions"), disposables);

		const provider = this.contextKeyService.getContextKeyValue<string>(NES_CONTEXT_PROVIDER);
		if (provider) {
			this.element.appendChild($('div.description', undefined, localize('positron.nes.provider', "Provider: {0}", provider)));
		}

		const model = this.contextKeyService.getContextKeyValue<INextEditSuggestionsModel>(NES_CONTEXT_MODEL);
		if (signedIn && model?.displayName) {
			this.element.appendChild($('div.description', undefined, localize('positron.nes.model', "Model: {0}", model.displayName)));
		}

		if (!signedIn) {
			const description = this.element.appendChild($('div.description'));
			const signIn = localize('positron.nes.signIn', "[Sign in to Posit AI]({0}) to enable Next Edit Suggestions.", `command:${CONFIGURE_PROVIDERS_COMMAND}`);
			for (const node of parseLinkedText(signIn).nodes) {
				if (typeof node === 'string') {
					description.append(...renderLabelWithIcons(node));
				} else {
					disposables.add(new Link(description, node, {
						opener: href => {
							void this.openerService.open(href, { allowCommands: [CONFIGURE_PROVIDERS_COMMAND] });
							this.hoverService.hideHover(true);
						}
					}, this.hoverService, this.openerService));
				}
			}
			return;
		}

		this.createSettings(this.element, disposables);

		const snooze = append(this.element, $('div.snooze-completions'));
		this.createSnooze(snooze, localize('positron.nes.snooze', "Snooze"), disposables);
	}

	private createHeader(container: HTMLElement, label: string, disposables: DisposableStore): void {
		const header = container.appendChild($('div.header', undefined, label));

		const toolbar = disposables.add(new ActionBar(header, { hoverDelegate: nativeHoverDelegate }));
		toolbar.push([toAction({
			id: 'positron.nextEditSuggestions.openSettings',
			label: localize('positron.nes.openSettings', "Open Settings"),
			tooltip: localize('positron.nes.openSettings', "Open Settings"),
			class: ThemeIcon.asClassName(Codicon.settingsGear),
			run: () => {
				void this.commandService.executeCommand('workbench.action.openSettings', '@ext:positron.next-edit-suggestions');
				this.hoverService.hideHover(true);
			}
		})], { icon: true, label: false });
	}

	private createSettings(container: HTMLElement, disposables: DisposableStore): void {
		const settings = container.appendChild($('div.settings'));

		settings.appendChild($('div.header', undefined, localize('positron.nes.settings', "Settings")));

		this.createSetting(append(settings, $('div.setting')), '*', localize('positron.nes.allFiles', "All files"), disposables);

		const modeId = this.editorService.activeTextEditorLanguageId;
		if (modeId) {
			this.createSetting(append(settings, $('div.setting')), modeId, this.languageService.getLanguageName(modeId) ?? modeId, disposables);
		}
	}

	private createSetting(container: HTMLElement, key: string, label: string, disposables: DisposableStore): void {
		const languageId = key === '*' ? undefined : key;
		const checkbox = disposables.add(new Checkbox(label, isNextEditSuggestionsEnabled(this.configurationService, languageId), { ...defaultCheckboxStyles }));
		container.appendChild(checkbox.domNode);

		const settingLabel = append(container, $('span.setting-label', undefined, label));
		disposables.add(Gesture.addTarget(settingLabel));
		[EventType.CLICK, TouchEventType.Tap].forEach(eventType => {
			disposables.add(addDisposableListener(settingLabel, eventType, e => {
				if (checkbox.enabled) {
					EventHelper.stop(e, true);
					checkbox.checked = !checkbox.checked;
					checkbox.focus();
				}
			}));
		});

		disposables.add(checkbox.onChange(() => {
			void setNextEditSuggestionsEnabled(this.configurationService, key, checkbox.checked);
		}));

		disposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(NES_ENABLE_SETTING)) {
				checkbox.checked = isNextEditSuggestionsEnabled(this.configurationService, languageId);
			}
		}));
	}

	private createSnooze(container: HTMLElement, label: string, disposables: DisposableStore): void {
		const isEnabled = () =>
			isNextEditSuggestionsEnabled(this.configurationService) ||
			isNextEditSuggestionsEnabled(this.configurationService, this.editorService.activeTextEditorLanguageId);

		// Snooze is the global inline completions snooze, so it also pauses other providers (e.g. Copilot).
		const button = disposables.add(new Button(container, { disabled: !isEnabled(), ...defaultButtonStyles, hoverDelegate: nativeHoverDelegate, secondary: true }));

		const timerDisplay = container.appendChild($('span.snooze-label'));

		const actionBar = container.appendChild($('div.snooze-action-bar'));
		const toolbar = disposables.add(new ActionBar(actionBar, { hoverDelegate: nativeHoverDelegate }));
		const cancelAction = toAction({
			id: 'positron.nextEditSuggestions.cancelSnooze',
			label: localize('positron.nes.cancelSnooze', "Cancel Snooze"),
			run: () => this.inlineCompletionsService.cancelSnooze(),
			class: ThemeIcon.asClassName(Codicon.stopCircle)
		});

		const update = (enabled: boolean): boolean => {
			container.classList.toggle('disabled', !enabled);
			toolbar.clear();

			const timeLeftMs = this.inlineCompletionsService.snoozeTimeLeft;
			if (!enabled || timeLeftMs <= 0) {
				timerDisplay.textContent = localize('positron.nes.snooze5minutesTitle', "Hide suggestions for 5 min");
				timerDisplay.title = '';
				button.label = label;
				button.setTitle(localize('positron.nes.snooze5minutes', "Hide inline suggestions for 5 min"));
				return true;
			}

			const timeLeftSeconds = Math.ceil(timeLeftMs / 1000);
			const minutes = Math.floor(timeLeftSeconds / 60);
			const seconds = timeLeftSeconds % 60;

			timerDisplay.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds} ${localize('positron.nes.remainingTime', "remaining")}`;
			timerDisplay.title = localize('positron.nes.snoozeTimeDescription', "Inline suggestions are hidden for the remaining duration");
			button.label = localize('positron.nes.plus5min', "+5 min");
			button.setTitle(localize('positron.nes.snoozeAdditional5minutes', "Snooze additional 5 min"));
			toolbar.push([cancelAction], { icon: true, label: false });

			return false;
		};

		const timerDisposables = disposables.add(new DisposableStore());
		const updateIntervalTimer = () => {
			timerDisposables.clear();
			const enabled = isEnabled();

			if (update(enabled)) {
				return;
			}

			timerDisposables.add(disposableWindowInterval(getWindow(container), () => update(enabled), 1000));
		};
		updateIntervalTimer();

		disposables.add(button.onDidClick(() => {
			this.inlineCompletionsService.snooze();
			update(isEnabled());
		}));

		disposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(NES_ENABLE_SETTING)) {
				button.enabled = isEnabled();
			}
			updateIntervalTimer();
		}));

		disposables.add(this.inlineCompletionsService.onDidChangeIsSnoozing(() => {
			updateIntervalTimer();
		}));
	}
}
