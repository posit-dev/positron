---
name: positron-data-grid-pattern
description: Use when building a list, table, grid, or virtualized scrolling UI in Positron, or touching `DataGridInstance` / `PositronDataGrid`. Avoids the common mistake of mediating props into the instance via useEffect.
---

# Positron Data Grid Pattern

Positron has a virtualized grid system built around an abstract `DataGridInstance` and a renderer component `<PositronDataGrid />`. The pattern is non-obvious from outside, and the wrong instinct is to build a React wrapper component that takes props and pushes them into the instance via `useEffect`. **Don't.** This skill exists so you don't make that mistake.

## The core insight

**A `DataGridInstance` subclass IS the data grid.**

The instance owns:
- Items / data (or knows how to fetch it)
- The item renderer
- Layout (column widths, row heights, overrides, pinning)
- Selection, cursor, scroll position
- Outbound events (`onDidUpdate`, custom events from the subclass)

`<PositronDataGrid instance={...} />` is a thin React renderer over *any* `DataGridInstance` subclass. It does not own state. It just observes the instance and paints.

## The pattern

The shared shape, regardless of data strategy:

```tsx
// 1. Pick or build a DataGridInstance subclass.
//    - Embed strategy: subclass PositronListInstance, or DataGridInstance directly.
//    - fetchData strategy: subclass DataGridInstance and override fetchData().

// 2. The caller creates exactly one instance for the component's lifetime.
const [instance] = useState(() => new MySubclass({ /* options */ }));

// 3. The caller subscribes to instance events as needed.
useEffect(() => {
    const d = instance.onDidSomething(payload => /* ... */);
    return () => d.dispose();
}, [instance]);

// 4. Dispose on unmount.
useEffect(() => () => instance.dispose(), [instance]);

// 5. Render the grid.
return <PositronDataGrid instance={instance} />;
```

How data gets into the instance depends on the strategy:

- **Embed strategy** (e.g. `PositronListInstance`): the caller pushes items in via a setter the subclass exposes. Example:
  ```tsx
  useEffect(() => {
      instance.setItems(items);
  }, [instance, items]);
  ```
  This setter is specific to `PositronListInstance`; other embed subclasses can expose whatever shape they want.

- **fetchData strategy** (e.g. `TableDataDataGridInstance`): the caller does **not** push data in. The subclass owns its data source - typically wired to a comm/backend in its constructor or via a method that connects it. The base class then calls `fetchData(...)` whenever the viewport needs cells, and the subclass populates its cache and returns.

Either way: no React wrapper component sits between the caller and the instance. The instance is the API surface.

## The anti-pattern (do NOT do this)

Don't build `<MyList items={...} renderItem={...} onActivate={...} />` as a React component that internally:
- holds the instance in `useMemo` / `useState`
- pushes every prop into the instance via `useEffect(() => instance.setX(props.x), [props.x])`
- mirrors the instance's events back out as React props

Symptoms that you're heading the wrong way:
- A pile of small `useEffect`s that all just call setters on the instance.
- A `useEffect` that re-creates the instance when one of its construction options changes (and a paired disposal effect to handle the swap).
- Comments explaining why a ref or a thunk indirection is needed to keep a closure stable inside the instance.

If you see those, delete the wrapper. Let the caller drive the instance directly.

## Two data strategies

A `DataGridInstance` subclass can manage data in one of two ways. Pick based on dataset size.

### Strategy A: embed the data in memory

For small-to-medium lists where the entire dataset fits comfortably in memory.

- The subclass holds the items in a private field.
- Caller pushes in via a setter (e.g. `setItems`).
- `fetchData()` is implemented as a no-op.

Example: `PositronListInstance`.

### Strategy B: implement `fetchData` for lazy/virtualized data

For huge datasets where holding everything in memory is infeasible. The base class calls `fetchData(rowStartIndex, rowCount, columnStartIndex, columnCount)` (or similar) when it needs the cells for the visible viewport.

- The subclass connects to a backend (data explorer comms, DuckDB, etc.).
- `fetchData` populates the cache for the requested window.
- `cell(col, row)` returns from the cache.
- The subclass typically owns its own schema/columns, not just rows.

Examples: `TableDataDataGridInstance`, `TableSummaryDataGridInstance`, `InlineTableDataGridInstance`, `ColumnSelectorDataGridInstance`.

You generally know which you need before writing a line: is the dataset bounded and small? Embed. Is it backed by a query/file/comm and possibly enormous? Implement `fetchData`.

## Customizing grid behavior

The subclass passes options to `super(...)` in its constructor - column/row headers, scrollbars (and overscroll), pinning, selection, resizing, automatic layout, etc. The same `<PositronDataGrid />` renderer adapts to all of these via the instance's configuration.

If you need a behavior the base class doesn't expose, the path is usually:
1. Add the option to `DataGridInstance`'s options type and constructor.
2. Plumb it down to whatever subsystem needs it (LayoutManager, scroll, etc.).
3. Update existing subclasses if their defaults change.

This is invasive - many subclasses share the base - so weigh the cost before going there.

## Existing subclasses to read for reference

- `PositronListInstance` - single-column virtualized list (embed strategy).
- `TableDataDataGridInstance` - main data explorer table (fetchData strategy).
- `TableSummaryDataGridInstance` - column summary panel (fetchData strategy).
- `InlineTableDataGridInstance` - inline data preview in notebook outputs (fetchData strategy).
- `ColumnSelectorDataGridInstance` - column picker in modals (fetchData strategy).

Skim two before writing a new one.

## Quick checklist when adding a new grid-style UI

- [ ] Is there an existing subclass that fits? (Don't reinvent.)
- [ ] If new: subclass `DataGridInstance` (or an existing subclass), implement what's required.
- [ ] Pick embed vs. fetchData based on dataset size.
- [ ] Caller creates the instance once via `useState(() => new MySubclass(...))`.
- [ ] Caller pushes in data via setters, subscribes to events, disposes on unmount.
- [ ] Render with `<PositronDataGrid instance={instance} />`.
- [ ] No React wrapper component mediating props into the instance.
