The code in this folder is licensed under MIT.

## R TextMate Grammar

To generate `r.tmGrammar.gen.json` from `r.tm.Grammar.src.json`, first navigate to the positron-r extension folder:

```
cd extensions/positron-r
```

then run:

```
yarn compile-syntax
```

`compile-syntax` is a custom typescript script that performs glue-like interpolation, i.e. `{{ bracket }}` in the `src` file will get interpolated as `keyword.operator` in the `gen` file. The substitutions are based on the `"variables"` field of the `src` file, and are intended to avoid repetition of these style names, and to make it easier to change them all at once if we ever need to.
