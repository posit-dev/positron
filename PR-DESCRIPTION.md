# Positron Notebooks: renderer-aware output mime selection, renderer webview fallback, and HTML fidelity

Addresses:

- Fixes https://github.com/posit-dev/positron/issues/13996 (py3Dmol output fails with "Can't handle mime type application/3dmoljs_load.v0")
- Fixes https://github.com/posit-dev/positron/issues/10473 (images in `IPython.display.HTML` output do not appear)
- Fixes https://github.com/posit-dev/positron/issues/12686 (`text/html` + `isolated: true` outputs are not isolated)
- Addresses https://github.com/posit-dev/positron/issues/13106 (vegalite v5 / ggsql outputs): the data path and the renderer fallback are fixed, so the output renders as soon as a notebook renderer extension for `application/vnd.vegalite.v5+json` is installed. No vega-lite renderer ships with Positron today, so out of the box the output now degrades to its text representation instead of an error (see QA Notes).

### Summary

The Positron Notebook Editor picked which mime type to render with a hardcoded priority list that preferred *any* `application/*` mime over `text/html`, so bundles like py3Dmol's `{application/3dmoljs_load.v0, text/html}` picked the unrenderable custom mime and errored. This PR replaces that with the upstream renderer-registry machinery and layers three related output-fidelity fixes on top. One commit per chunk:

1. **`toOutputItems` encoding fix** (`runtimeNotebookCellExecution.ts`): payload encoding is now decided by the value's type instead of a hardcoded `+json` mime allowlist. Object payloads for unlisted mimes (e.g. `application/vnd.vegalite.v5+json`, which ggsql emits) previously became `"[object Object]"` via `String(value)`.
2. **Renderer-aware mime selection** (`notebookOutputUtils.ts`, `PositronNotebookCodeCell.ts`): `resolvePreferredOutputItem` walks `INotebookService.getMimeTypeInfo` ordering (the same logic as upstream's `CellOutputViewModel.resolveMimeTypes`) and picks the first mime Positron renders natively or that has a registered renderer. An unrenderable custom mime can no longer beat a renderable fallback. The unknown-mime message is now actionable ("No renderer available for MIME type... Install a notebook renderer extension...").
3. **Generic renderer-extension webview fallback** (`positronWebviewPreloadsService.ts`): mimes with a registered notebook renderer extension (but no native Positron rendering) are hosted in the existing renderer-runtime overlay webview (`createMultiMessageWebview`), with the same content-keyed caching and reconciliation as plot/raw-HTML overlays.
4. **HTML output fidelity** (`NotebookCodeCell.tsx`, `notebookOutputUtils.ts`): inline HTML fragments now render `<img>` through `DeferredImage` (resolves relative paths against the notebook directory, mirroring the markdown pipeline) and `<a>` through `NotebookLink`; Jupyter's `isolated: true` output metadata forces the sandboxed webview route regardless of content.

Known limitation: images inside full-document HTML rendered via `ShadowDomContent` are not rewritten (raw innerHTML path); fragments (the `IPython.display.HTML` case from the issue) are covered.

### Release Notes

#### New Features

- Positron notebook outputs with a registered notebook renderer extension now render through that renderer (https://github.com/posit-dev/positron/issues/13106)

#### Bug Fixes

- py3Dmol and similar custom-mime output bundles render their HTML fallback instead of erroring in Positron notebooks (https://github.com/posit-dev/positron/issues/13996)
- Relative images inside `IPython.display.HTML` output now display in Positron notebooks (https://github.com/posit-dev/positron/issues/10473)
- `text/html` outputs with `isolated: true` metadata render in an isolated webview in Positron notebooks (https://github.com/posit-dev/positron/issues/12686)
- Structured (object) output payloads for custom `+json` mime types are JSON-encoded instead of becoming `"[object Object]"` (https://github.com/posit-dev/positron/issues/13106)

### Validation Steps

@:positron-notebooks @:notebooks @:html

Unit coverage (all Vitest, no daemons needed):

- `npx vitest run src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/runtimeNotebookCellExecution.vitest.ts`
- `npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/notebookOutputUtils.vitest.ts`
- `npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookCellOutputs.vitest.ts`
- `npx vitest run src/vs/workbench/contrib/positronWebviewPreloads/test/browser/positronWebviewPreloadRendererFallback.vitest.ts`
- `npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/cellOutputHtml.vitest.tsx`

Manual QA (all in the Positron Notebook Editor with a Python kernel):

1. **py3Dmol** -- expect an interactive 3D protein view (webview), not a mime-type error:

	```python
	%pip install py3Dmol
	import py3Dmol
	view = py3Dmol.view(query='pdb:1UBQ', width=400, height=300)
	view.setStyle({'cartoon': {'color': 'spectrum'}})
	view.show()
	```

2. **vegalite v5** -- without a renderer extension, expect the plain-text repr (not `[object Object]`, not an error). With a marketplace vega-lite renderer installed (or ggsql contributing one), expect the chart in a webview:

	```python
	from IPython.display import display
	spec = {
	    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
	    "data": {"values": [{"a": 1, "b": 28}, {"a": 2, "b": 55}, {"a": 3, "b": 43}]},
	    "mark": "point",
	    "encoding": {"x": {"field": "a", "type": "quantitative"}, "y": {"field": "b", "type": "quantitative"}},
	}
	display({"application/vnd.vegalite.v5+json": spec, "text/plain": "<VegaLite chart>"}, raw=True)
	```

	Also verify with ggsql (R) per https://github.com/posit-dev/positron/issues/13106 if available.

3. **Relative image in `IPython.display.HTML`** -- put a `test.png` next to a saved notebook; expect the image at 400px, not a broken icon:

	```python
	from IPython.display import HTML
	HTML('<img src="test.png" width="400">')
	```

4. **Isolated HTML** -- run the `IsolatedHTML` snippet from https://github.com/posit-dev/positron/issues/12686; expect the styled content in an isolated webview and no style leakage into the notebook UI (notebook background unchanged).

5. **Regressions** -- run cells producing: matplotlib PNG, plotly, ipywidgets (`ipywidgets.IntSlider()`), Great Tables (inert full-document HTML, must stay inline), `%%html` with a `<script>`, and a pandas DataFrame (data explorer output must still win over `text/html`).

### QA Notes

- Chunk 1 changes the runtime kernel's output encoding shared by both notebook editors; the other chunks are Positron-Notebook-Editor only.
- For https://github.com/posit-dev/positron/issues/13106 to render a chart out of the box, product needs to pick a renderer story (bundle a vega-lite renderer vs. ggsql contributing one vs. marketplace `ms-toolsai.jupyter-renderers`). This PR makes any of those work without further core changes.
