# Positron QMD Extension

Experimental support for Quarto Markdown (QMD) notebooks in Positron.

## Status

**Experimental** - This extension is under active development and hidden behind an experimental setting.

## Enabling

To enable QMD notebook support:

1. Open Settings (Cmd/Ctrl + ,)
2. Search for "plaintext notebook"
3. Enable "Notebook: Plain Text: Enable"

Or add to `settings.json`:

```json
{
  "notebook.plainText.enable": true
}
```

## Features

- Parse QMD files using a WASM-based parser
- (Coming soon) Open QMD files in the Notebook UI
- (Coming soon) Save notebooks back to QMD format

## Development

### Prerequisites

1. Build the WASM parser:
   ```sh
   cd ../kyoto/crates/wasm-qmd-parser
   wasm-pack build --target nodejs
   ```

2. Install dependencies:
   ```sh
   cd extensions/positron-qmd
   npm install
   ```

### Running Tests

```sh
# Extension tests
npm run test-extension -- -l positron-qmd

# E2E tests
npx playwright test test/e2e/tests/qmd/ --project e2e-electron
```

### Architecture

The extension uses a WASM-based QMD parser for performance and correctness.
The WASM module is built from Rust code in the `kyoto` repository.
