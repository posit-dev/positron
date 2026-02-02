# Positron UI Components

Context for working with Positron's reusable UI components.

## Core Principles

1. **Search before creating** - Many controls already exist
2. **Understand context requirements** - Some components need specific React contexts
3. **Ask when unclear** - When facing subjective decisions about component reuse or styling, ask the developer

## Component Locations

| Location | Contains |
|----------|----------|
| `src/vs/base/browser/ui/positronComponents/` | Base primitives (Button, Scrollable, ScreenReaderOnly, splitters) |
| `src/vs/workbench/browser/positronComponents/` | Workbench components (modals, dropdowns, popups) |
| `src/vs/workbench/browser/positronComponents/positronModalDialog/components/` | Modal sub-components (Checkbox, RadioGroup, LabeledTextInput, etc.) |
| `src/vs/workbench/contrib/positron*/` | Feature-specific components (data explorer, console, plots, etc.) |
| `src/vs/workbench/browser/positronActionBar/` | Action bar controls (require context) |

## Context Requirements

**Action bar components** (`positronActionBar/`) use `useRegisterWithActionBar` hook requiring `PositronActionBarContext`. They cannot be used directly in modals or dialogs.

**For buttons in modals:** Use the base `Button` component from `vs/base/browser/ui/positronComponents/button/button.tsx` with `action-bar-button` CSS class. Modal styles already define these classes.

## Finding Components

Start with glob patterns in these directories:
```
**/positronComponents/**/*.tsx
**/positronModalDialog/components/*.tsx
**/positronActionBar/**/components/*.tsx
```

Search for specific control types:
```
Grep: "Checkbox" glob:*positron*.tsx
Grep: "DropDownListBox" type:tsx
```

## Key Components

### Buttons
- **`Button`** (`button/button.tsx`) - **Preferred for new code.** Uses native `<button>` element for proper semantic HTML. Has minimal/reset styling (transparent background, no border) so it works well for custom styling. Supports hover/tooltip via `hoverManager`.
- **`PositronButton`** (`button/positronButton.tsx`) - Legacy, uses `<div>`. Prefer `Button`.

### Modal Components
Located in `positronModalDialog/components/`:
- `Checkbox`, `RadioGroup`, `RadioButton` - Form controls
- `LabeledTextInput`, `LabeledFolderInput` - Text inputs with labels
- `OkCancelActionBar`, `OkActionBar` - Dialog button bars
- `ContentArea`, `VerticalStack`, `VerticalSpacer` - Layout helpers

### Other Primitives
- `DropDownListBox` - Select/dropdown inputs
- `Scrollable` - Scrollable container
- `ScreenReaderOnly` - Accessibility helper for visually hidden content

## CSS Patterns

Conditional class names:
```typescript
import { positronClassNames } from 'vs/base/common/positronUtilities';

const className = positronClassNames(
    'base-class',
    { 'active': isActive, 'disabled': isDisabled }
);
```

## When to Ask the Developer

- Multiple similar components exist - which pattern to follow?
- Unclear whether to reuse existing component or create new
- Styling/UX subjective choices (button placement, labels, etc.)
- Component seems close but not quite right - modify or create new?

Examples:
- "I found similar controls in DataExplorer and Variables - which pattern should I follow?"
- "Should I reuse DropDownListBox or create a custom select for this use case?"
- "This could use the existing Checkbox or a simpler native input - preference?"
