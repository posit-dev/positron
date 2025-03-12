/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { Emitter } from '../../../../../base/common/event.js';
import { IChatRequestVariableEntry } from '../../common/chatModel.js';
import { ChatInstructionsFileLocator } from './chatInstructionsFileLocator.js';
import { PromptFilesConfig } from '../../common/promptSyntax/config.js';
import { IPromptFileReference } from '../../common/promptSyntax/parsers/types.js';
import { ChatInstructionsAttachmentModel } from './chatInstructionsAttachment.js';
import { Disposable, DisposableMap } from '../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';

/**
 * Utility to convert a {@link reference} to a chat variable entry.
 * The `id` of the chat variable can be one of the following:
 *
 * - `vscode.prompt.instructions__<URI>`: for all non-root prompt file references
 * - `vscode.prompt.instructions.root__<URI>`: for *root* prompt file references
 * - `<URI>`: for the rest of references(the ones that do not point to a prompt file)
 *
 * @param reference A reference object to convert to a chat variable entry.
 * @param isRoot If the reference is the root reference in the references tree.
 * 				 This object most likely was explicitly attached by the user.
 */
export const toChatVariable = (
	reference: Pick<IPromptFileReference, 'uri' | 'isPromptSnippet'>,
	isRoot: boolean,
): IChatRequestVariableEntry => {
	const { uri, isPromptSnippet } = reference;

	// default `id` is the stringified `URI`
	let id = `${uri}`;

	// for prompt files, we add a prefix to the `id`
	if (isPromptSnippet) {
		// the default prefix that is used for all prompt files
		let prefix = 'vscode.prompt.instructions';
		// if the reference is the root object, add the `.root` suffix
		if (isRoot) {
			prefix += '.root';
		}

		// final `id` for all `prompt files` starts with the well-defined
		// part that the copilot extension(or other chatbot) can rely on
		id = `${prefix}__${id}`;
	}

	return {
		id,
		name: uri.fsPath,
		value: uri,
		isSelection: false,
		enabled: true,
		isFile: true,
		isDynamic: true,
		isMarkedReadonly: isPromptSnippet,
	};
};

/**
 * Model for a collection of prompt instruction attachments.
 * See {@linkcode ChatInstructionsAttachmentModel} for individual attachment.
 */
export class ChatInstructionAttachmentsModel extends Disposable {
	/**
	 * Helper to locate prompt instruction files on the disk.
	 */
	private readonly instructionsFileReader: ChatInstructionsFileLocator;

	/**
	 * List of all prompt instruction attachments.
	 */
	private attachments: DisposableMap<string, ChatInstructionsAttachmentModel> =
		this._register(new DisposableMap());

	/**
	 * Get all `URI`s of all valid references, including all
	 * the possible references nested inside the children.
	 */
	public get references(): readonly URI[] {
		const result = [];

		for (const child of this.attachments.values()) {
			result.push(...child.references);
		}

		return result;
	}

	/**
	 * Get the list of all prompt instruction attachment variables, including all
	 * nested child references of each attachment explicitly attached by user.
	 */
	public get chatAttachments(): readonly IChatRequestVariableEntry[] {
		const result = [];
		const attachments = [...this.attachments.values()];

		for (const attachment of attachments) {
			const { reference } = attachment;

			// the usual URIs list of prompt instructions is `bottom-up`, therefore
			// we do the same herfe - first add all child references of the model
			result.push(
				...reference.allValidReferences.map((link) => {
					return toChatVariable(link, false);
				}),
			);

			// then add the root reference of the model itself
			result.push(
				toChatVariable(reference, true),
			);
		}

		return result;
	}

	/**
	 * Promise that resolves when parsing of all attached prompt instruction
	 * files completes, including parsing of all its possible child references.
	 */
	public async allSettled(): Promise<void> {
		const attachments = [...this.attachments.values()];

		await Promise.allSettled(
			attachments.map((attachment) => {
				return attachment.allSettled;
			}),
		);
	}

	/**
	 * Event that fires then this model is updated.
	 *
	 * See {@linkcode onUpdate}.
	 */
	protected _onUpdate = this._register(new Emitter<void>());
	/**
	 * Subscribe to the `onUpdate` event.
	 * @param callback Function to invoke on update.
	 */
	public onUpdate(callback: () => unknown): this {
		this._register(this._onUpdate.event(callback));

		return this;
	}

	/**
	 * Event that fires when a new prompt instruction attachment is added.
	 * See {@linkcode onAdd}.
	 */
	protected _onAdd = this._register(new Emitter<ChatInstructionsAttachmentModel>());
	/**
	 * The `onAdd` event fires when a new prompt instruction attachment is added.
	 *
	 * @param callback Function to invoke on add.
	 */
	public onAdd(callback: (attachment: ChatInstructionsAttachmentModel) => unknown): this {
		this._register(this._onAdd.event(callback));

		return this;
	}

	constructor(
		@IInstantiationService private readonly initService: IInstantiationService,
		@IConfigurationService private readonly configService: IConfigurationService,
	) {
		super();

		this._onUpdate.fire = this._onUpdate.fire.bind(this._onUpdate);
		this.instructionsFileReader = initService.createInstance(ChatInstructionsFileLocator);
	}

	/**
	 * Add a prompt instruction attachment instance with the provided `URI`.
	 * @param uri URI of the prompt instruction attachment to add.
	 */
	public add(uri: URI): this {
		// if already exists, nothing to do
		if (this.attachments.has(uri.path)) {
			return this;
		}

		const instruction = this.initService.createInstance(ChatInstructionsAttachmentModel, uri)
			.onUpdate(this._onUpdate.fire)
			.onDispose(() => {
				// note! we have to use `deleteAndLeak` here, because the `*AndDispose`
				//       alternative results in an infinite loop of calling this callback
				this.attachments.deleteAndLeak(uri.path);
				this._onUpdate.fire();
			});

		this.attachments.set(uri.path, instruction);
		instruction.resolve();

		this._onAdd.fire(instruction);
		this._onUpdate.fire();

		return this;
	}

	/**
	 * Remove a prompt instruction attachment instance by provided `URI`.
	 * @param uri URI of the prompt instruction attachment to remove.
	 */
	public remove(uri: URI): this {
		// if does not exist, nothing to do
		if (!this.attachments.has(uri.path)) {
			return this;
		}

		this.attachments.deleteAndDispose(uri.path);

		return this;
	}

	/**
	 * List prompt instruction files available and not attached yet.
	 */
	public async listNonAttachedFiles(): Promise<readonly URI[]> {
		return await this.instructionsFileReader.listFiles(this.references);
	}

	/**
	 * Checks if the prompt instructions feature is enabled in the user settings.
	 */
	public get featureEnabled(): boolean {
		return PromptFilesConfig.enabled(this.configService);
	}
}
