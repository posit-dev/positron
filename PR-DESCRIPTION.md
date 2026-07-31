# Add save image and open output in new tab actions to Positron notebook outputs

Addresses https://github.com/posit-dev/positron/issues/12841.

### Summary

The Positron Notebook Editor's floating output action bar and output context menu now offer the two image actions the Quarto inline output view already has:

- **Save Image As...** shows a save dialog (defaulting to `<notebook>_cell<N>.<ext>` next to the notebook) and writes the image - the notebook equivalent of Quarto's "Save plot".
- **Open Output in New Tab** opens the image in a new preview editor tab - the notebook equivalent of Quarto's popout. Like the Quarto implementation, the image is written to a hidden `.positron-temp-*` file next to the notebook, since the image editor needs a file-backed resource.

Both actions appear in the floating action bar when a cell has exactly one image output (the same rule as the existing Copy Image button), and in the right-click menu on any image output (targeting the clicked image, forwarded the same way as Copy Image). PNG and SVG outputs are supported.

Implementation notes:

- New `imageOutputUtils.ts` holds the decode/save/open helpers. The save flow mirrors `quartoOutputManager.ts`'s `_savePlot` and the popout mirrors its `_openPlotInEditor`.
- Image-target resolution (context-menu arg, falling back to the active cell's first image output) is now shared with the existing Copy Image action via a `getTargetedImageOutput` helper.
- A new `Export` menu group sorts between Copy and Visibility in the output action menus.

### Release Notes

#### New Features

- Positron Notebooks: image outputs now have "Save Image As..." and "Open Output in New Tab" actions in the output action bar and context menu, matching the Quarto inline output view (#12841)

#### Bug Fixes

- N/A

### Validation Steps

@:positron-notebooks

With Positron notebooks enabled, open an `.ipynb` and run a cell that produces a plot (e.g. `import matplotlib.pyplot as plt; plt.plot([1, 2, 3])`), then:

1. Hover over the output: the floating action bar should show Copy Image, Save Image As... (save icon), and Open Output in New Tab (link-external icon).
2. Save Image As... should open a save dialog defaulting to `<notebook>_cell<N>.png` in the notebook's folder; saving writes the file and shows a "saved" toast.
3. Open Output in New Tab should open the plot in a new preview editor tab.
4. Right-click the plot image: the context menu should show the same two actions under a separator below Copy Image, operating on the clicked image.
5. In a cell with multiple image outputs, the static bar buttons hide (same as Copy Image), but right-clicking an individual image still offers both actions.
6. SVG outputs (e.g. after `%config InlineBackend.figure_formats = ['svg']`) save and open with an `.svg` extension.

Unit tests: `npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/imageOutputUtils.vitest.ts`
