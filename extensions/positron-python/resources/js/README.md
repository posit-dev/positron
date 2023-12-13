# Positron Python Javascript resources
This folder contains the Javascript resources for the Positron Python extension, specifically needed to support the IPyWidgets integration. Embedding IPyWidgets in contexts other than a Jupyter Notebook (for example, in the Positron Plots pane) requires both the custom widget manager in [`@jupyter-widgets/html-manager`](https://www.npmjs.com/package/@jupyter-widgets/html-manager/v/1.0.9) as well as [RequireJS](https://www.npmjs.com/package/requirejs), to manage dependencies for embedding both custom and standard widgets (see details in [the IPyWidgets documentation](https://ipywidgets.readthedocs.io/en/latest/embedding.html)). In order to make these files available to Positron, these dependencies are added to the [`package.json`](../../package.json) and then installed by running `yarn` from the extension root.

## Scripts contained in this folder
The scripts in this folder must be manually placed here, by copying them over from the `node_modules` folder after running `yarn` from the extension root. For example,

```bash
cp node_modules/@jupyter-widgets/html-manager/dist/embed-amd.js resources/js/@jupyter-widgets/html-manager/dist/embed-amd.js
cp node_modules/requirejs/require.js resources/js/requirejs/require.js
```

---
**NOTE**

Whenever we update the version of these modules in the `package.json` file, we must re-run `yarn` and then copy over the updated files to this folder. They will not be automatically synced.

---

## Current versions
The current versions of these modules are:
- `@jupyter-widgets/html-manager`: 1.0.9
- `requirejs`: 2.3.6
