/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import '../media/positronCheckpoints.css';

// React.
import { useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { PositronReactRenderer } from '../../../../../base/browser/positronReactRenderer.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { ByteSize } from '../../../../../platform/files/common/files.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { EditorInputCapabilities, IEditorOpenContext, IUntypedEditorInput } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IMAGE_DIFF_LIMIT_BYTES } from '../../common/checkpointsLimits.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { IRichDiffProvider, IRichDiffSide, IRichDiffSides } from './richDiffRegistry.js';

/** The extensions the image comparison handles, and the type of image each one holds. */
const IMAGE_MIME_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
};

function mimeTypeOf(path: string): string {
	return IMAGE_MIME_TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
}

/** How the two images are shown. */
type DiffMode = 'side-by-side' | 'slider';

/** Creates and revokes object URLs. The defaults are the browser's functions. */
export interface IObjectUrlFunctions {
	createObjectURL(blob: Blob): string;
	revokeObjectURL(url: string): void;
}

const browserObjectUrls: IObjectUrlFunctions = {
	createObjectURL: blob => URL.createObjectURL(blob),
	revokeObjectURL: url => URL.revokeObjectURL(url),
};

/**
 * The `blob:` URLs of the two sides. They are created when the object is made and revoked when
 * it is disposed. An image is only ever shown through an `img` element with one of these URLs,
 * so the scripts that an SVG file can contain never run.
 */
export class ImageObjectUrls extends Disposable {
	readonly left: string | undefined;
	readonly right: string | undefined;

	constructor(sides: Pick<IRichDiffSides, 'left' | 'right' | 'path'>, functions: IObjectUrlFunctions = browserObjectUrls) {
		super();
		const create = (side: IRichDiffSide | undefined): string | undefined => {
			if (!side) {
				return undefined;
			}
			// A copy of the bytes, so that the blob does not depend on a buffer that is reused.
			const url = functions.createObjectURL(new Blob([side.bytes.buffer.slice()], { type: mimeTypeOf(sides.path) }));
			this._register(toDisposable(() => functions.revokeObjectURL(url)));
			return url;
		};
		this.left = create(sides.left);
		this.right = create(sides.right);
	}
}

interface IImagePanelProps {
	side: IRichDiffSide | undefined;
	url: string | undefined;
	/** What the panel says when this side has no image. */
	emptyMessage: string;
	label: string;
}

/** One side: its label, the image (or the reason there is none), and the size line. */
const ImagePanel = ({ side, url, emptyMessage, label }: IImagePanelProps) => {
	const [pixels, setPixels] = useState<{ width: number; height: number }>();
	const [failed, setFailed] = useState(false);
	const bytes = side ? ByteSize.formatSize(side.bytes.byteLength) : undefined;

	return (
		<section aria-label={label} className='checkpoints-image-panel'>
			<h3 className='checkpoints-image-label'>{label}</h3>
			{url === undefined
				? <p className='checkpoints-note'>{emptyMessage}</p>
				: failed
					? <p className='checkpoints-note' role='alert'>{Strings.imageDiff.cannotShow()}</p>
					: <img
						alt={label}
						className='checkpoints-image'
						src={url}
						onError={() => setFailed(true)}
						onLoad={event => setPixels({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
					/>}
			{bytes !== undefined && (
				<p className='checkpoints-image-size'>
					{pixels ? Strings.imageDiff.size(pixels.width, pixels.height, bytes) : bytes}
				</p>
			)}
		</section>
	);
};

interface IImageDiffViewProps {
	left?: IRichDiffSide;
	right?: IRichDiffSide;
	urls: ImageObjectUrls;
}

/**
 * The content of the image comparison. Side by side shows both images with their sizes. The
 * slider stacks the images and sets how much of the newer one covers the older one. The slider
 * needs two images, so it is off while a side is absent.
 */
export const ImageDiffView = ({ left, right, urls }: IImageDiffViewProps) => {
	const [mode, setMode] = useState<DiffMode>('side-by-side');
	const [revealed, setRevealed] = useState(50);
	const [sliderFailed, setSliderFailed] = useState(false);
	const bothSides = urls.left !== undefined && urls.right !== undefined;
	const effectiveMode = bothSides ? mode : 'side-by-side';

	return (
		<div className='positron-checkpoints checkpoints-image-diff'>
			<div aria-label={Strings.imageDiff.modes()} className='checkpoints-image-modes' role='group'>
				<Button
					ariaChecked={effectiveMode === 'side-by-side'}
					className={`checkpoints-button${effectiveMode === 'side-by-side' ? ' checkpoints-button-primary' : ''}`}
					role='radio'
					onPressed={() => setMode('side-by-side')}
				>
					{Strings.imageDiff.sideBySide()}
				</Button>
				<Button
					ariaChecked={effectiveMode === 'slider'}
					className={`checkpoints-button${effectiveMode === 'slider' ? ' checkpoints-button-primary' : ''}`}
					disabled={!bothSides}
					role='radio'
					onPressed={() => setMode('slider')}
				>
					{Strings.imageDiff.slider()}
				</Button>
			</div>
			{effectiveMode === 'side-by-side' ? (
				<div className='checkpoints-image-panels'>
					<ImagePanel emptyMessage={Strings.imageDiff.isNew()} label={Strings.imageDiff.before()} side={left} url={urls.left} />
					<ImagePanel emptyMessage={Strings.imageDiff.wasRemoved()} label={Strings.imageDiff.after()} side={right} url={urls.right} />
				</div>
			) : (
				<div className='checkpoints-image-slider'>
					{sliderFailed
						? <p className='checkpoints-note' role='alert'>{Strings.imageDiff.cannotShow()}</p>
						: (
							<div className='checkpoints-image-stack'>
								<img alt={Strings.imageDiff.before()} className='checkpoints-image' src={urls.left} onError={() => setSliderFailed(true)} />
								<img
									alt={Strings.imageDiff.after()}
									className='checkpoints-image checkpoints-image-overlay'
									src={urls.right}
									style={{ clipPath: `inset(0 ${100 - revealed}% 0 0)` }}
									onError={() => setSliderFailed(true)}
								/>
							</div>
						)}
					<input
						aria-label={Strings.imageDiff.sliderLabel()}
						max={100}
						min={0}
						type='range'
						value={revealed}
						onChange={event => setRevealed(Number(event.currentTarget.value))}
					/>
				</div>
			)}
		</div>
	);
};

/**
 * The input of the image comparison. It holds the bytes of both sides. Two inputs match only
 * when they are the same object, so each opened comparison has its own tab.
 */
export class ImageDiffEditorInput extends EditorInput {
	static readonly TypeID = 'workbench.input.positronCheckpointsImageDiff';
	static readonly EditorID = 'workbench.editor.positronCheckpointsImageDiff';

	constructor(readonly sides: IRichDiffSides) {
		super();
	}

	override get resource(): URI | undefined {
		return undefined;
	}

	override get typeId(): string {
		return ImageDiffEditorInput.TypeID;
	}

	override get editorId(): string {
		return ImageDiffEditorInput.EditorID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly;
	}

	override getName(): string {
		return this.sides.title;
	}

	override getIcon(): ThemeIcon {
		return Codicon.fileMedia;
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput === this;
	}
}

/**
 * The editor pane of `ImageDiffEditorInput`. It creates the object URLs when an input is set
 * and revokes them when the input is cleared or the pane is disposed.
 */
export class ImageDiffEditorPane extends EditorPane {
	private readonly _container: HTMLElement;
	private readonly _renderer = this._register(new MutableDisposable<PositronReactRenderer>());
	private readonly _urls = this._register(new MutableDisposable<ImageObjectUrls>());

	constructor(
		group: IEditorGroup,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
	) {
		super(ImageDiffEditorInput.EditorID, group, telemetryService, themeService, storageService);
		this._container = DOM.$('.positron-checkpoints-image-diff-container');
	}

	protected override createEditor(parent: HTMLElement): void {
		parent.appendChild(this._container);
	}

	override async setInput(
		input: ImageDiffEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken
	): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested) {
			return;
		}
		const urls = new ImageObjectUrls(input.sides);
		this._urls.value = urls;
		const renderer = new PositronReactRenderer(this._container);
		this._renderer.value = renderer;
		renderer.render(<ImageDiffView left={input.sides.left} right={input.sides.right} urls={urls} />);
	}

	override clearInput(): void {
		this._renderer.clear();
		this._urls.clear();
		super.clearInput();
	}

	override layout(dimension: DOM.Dimension): void {
		DOM.size(this._container, dimension.width, dimension.height);
	}
}

/** The provider for the image formats. Its size limit is `IMAGE_DIFF_LIMIT_BYTES`. */
export const imageDiffProvider: IRichDiffProvider = {
	id: 'image',
	extensions: Object.keys(IMAGE_MIME_TYPES),
	maxSideBytes: IMAGE_DIFF_LIMIT_BYTES,
	async open(accessor: ServicesAccessor, sides: IRichDiffSides): Promise<void> {
		const editorService = accessor.get(IEditorService);
		await editorService.openEditor(new ImageDiffEditorInput(sides), { pinned: true });
	},
};
