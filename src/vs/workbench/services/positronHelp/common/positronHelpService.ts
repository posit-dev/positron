/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { IOpenerService, OpenExternalOptions } from 'vs/platform/opener/common/opener';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { HelpDescriptor, IPositronHelpService } from 'vs/workbench/services/positronHelp/common/interfaces/positronHelpService';
import { LanguageRuntimeEventData, LanguageRuntimeEventType, ShowHelpEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEvents';

/**
 * Custom custom type guard for ShowHelpEvent.
 * @param _ The LanguageRuntimeEventData that should be a ShowHelpEvent.
 * @returns true if the LanguageRuntimeEventData is a ShowHelpEvent; otherwise, false.
 */
const isShowHelpEvent = (_: LanguageRuntimeEventData): _ is ShowHelpEvent => {
	return (_ as ShowHelpEvent).kind !== undefined;
};

// // The TrustedTypePolicy for rendering.
// const ttPolicyPositronHelp = window.trustedTypes?.createPolicy('positronHelp', {
// 	createHTML: value => value,
// 	createScript: value => value
// });

/**
 * PositronHelpService class.
 */
export class PositronHelpService extends Disposable implements IPositronHelpService {
	//#region Private Properties

	/**
	 * The onDidStartPositronConsoleInstance event emitter.
	 */
	private readonly _onRenderHelpEmitter = this._register(new Emitter<HelpDescriptor>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _languageRuntimeService The ILanguageRuntimeService, whose Help events we listen to.
	 * @param _logService The ILogService.
	 * @param _openerService The IOpenerService.
	 */
	constructor(
		@ILanguageRuntimeService private _languageRuntimeService: ILanguageRuntimeService,
		@ILogService private _logService: ILogService,
		@IOpenerService private _openerService: IOpenerService
	) {
		// Call the base class's constructor.
		super();

		// Register our runtime event handler.
		this._register(
			this._languageRuntimeService.onDidReceiveRuntimeEvent(async languageRuntimeGlobalEvent => {
				// Process show help global events.
				if (languageRuntimeGlobalEvent.event.name === LanguageRuntimeEventType.ShowHelp) {
					// Ensure that the right event data was supplied.
					if (!isShowHelpEvent(languageRuntimeGlobalEvent.event.data)) {
						this._logService.error(`ShowHelp event supplied unsupported event data.`);
					} else {
						// Process the show help event.
						const showHelpEvent = languageRuntimeGlobalEvent.event.data as ShowHelpEvent;
						if (showHelpEvent.kind === 'url') {
							// Raise the onRenderHelp event.
							this._onRenderHelpEmitter.fire({
								url: showHelpEvent.content,
								focus: showHelpEvent.focus
							});

							// For Private Alpha (August 2023), just open the help URL.
							this._openerService.open(showHelpEvent.content, {
								openExternal: true
							} satisfies OpenExternalOptions);
						} else {
							this._logService.error(`PositronHelpService does not support ${showHelpEvent.kind}.`);
						}
					}
				}
			})
		);
	}

	//#endregion Constructor & Dispose

	//#region IPositronHelpService Implementation

	/**
	 * Needed for service branding in dependency injector.
	 */
	declare readonly _serviceBrand: undefined;

	/**
	 * The onRenderHelp event.
	 */
	readonly onRenderHelp = this._onRenderHelpEmitter.event;

	/**
	 * Placeholder that gets called to "initialize" the PositronHelpService.
	 */
	initialize() {
	}

	//#endregion IPositronHelpService Implementation

	//#region Private Methods
	//#endregion Private Methods
}

// Register the Positron help service.
registerSingleton(IPositronHelpService, PositronHelpService, InstantiationType.Eager);
