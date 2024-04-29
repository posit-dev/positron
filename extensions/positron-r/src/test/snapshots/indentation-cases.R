# Indentation snapshots. Edit cases in `indentation-cases.R` and observe results
# in `indentation-snapshots.R`.
#
# The cursor position is represented by a string containing angular brackets. A
# newline is typed at that position, triggering indentation rules. The result is
# saved in the snapshot file.
#
# Snippets are separated by `# ---`. This makes it possible to extract them and
# process them separately to prevent interferences between test cases.

# ---
# Starting a pipeline (+ operator)
1 +"<>"

# ---
# Starting a pipeline (pipe operator)
data |>"<>"

# ---
# Starting a pipeline (one empty line)
data |>
    "<>"

# ---
# Starting a pipeline (multiple empty lines)
data |>

    "<>"

# ---
# Continuing a pipeline
1 +
    2 +"<>"

# ---
# Continuing a one-liner pipeline
# https://github.com/posit-dev/positron/issues/1316
data |>
    fn() |>"<>"

# ---
# Continuing a one-liner pipeline (trailing whitespace)
# https://github.com/posit-dev/positron/pull/1655#issuecomment-1780093395
data |>
    fn() |> "<>"

# ---
# Continuing a one-liner pipeline (trailing comment)
data |>
    fn() |> "<>" # foo

# ---
# Continuing a one-liner pipeline (comment line)
data |>
    fn1() |>
    # foo"<>"

# ---
# Continuing a one-liner pipeline (after a comment line)
data |>
    fn1() |>
    # foo
    "<>"

# ---
# Continuing a one-liner pipeline (longer pipeline)
data |>
    fn1() |>
    fn2() |>"<>"


# ---
# Continuing a multi-liner pipeline
data |>
    fn1(
        x,
        y
    ) |>"<>"

# ---
# Continuing a multi-liner pipeline (trailing expression)
data |>
    fn1(
        x,
        y
    ) |> "<>" fn2()

# ---
# Dedent after pipeline
data |>
    fn()"<>"

# ---
# Dedent after pipeline (trailing comment)
data |>
    fn()"<>" # foo

# ---
# Dedent after pipeline (multiple lines)
# FIXME
data |>
    fn1() |>
    fn2(
        "arg"
    )"<>"

# ---
# Dedent after pipeline (token)
1 +
    foo(
        x
    ) +
    bar"<>"

# ---
# Stickiness of dedent after pipeline
# https://github.com/posit-dev/positron/issues/1727
data |>
    fn()
"<>"

# ---
# Stickiness of dedent after pipeline (trailing comment)
data |>
    fn()
"<>" # foo

# ---
# Indent after function in call
# FIXME
{
    fn(function() {}"<>")
}

# ---
# Indent after function in call (multiple lines)
# FIXME
{
    fn(function() {
        #
    }"<>")
}

# ---
# Indent after finished loop (literal)
for (i in NA) NULL"<>"

# ---
# Indent after finished loop (call)
# https://github.com/posit-dev/positron/issues/1880
# FIXME
for (i in 1) fn()"<>"

# ---
# Breaking parentheses
foo("<>") +
    bar()

# ---
# Breaking parentheses in a pipeline
# https://github.com/posit-dev/positron/issues/2650
# https://github.com/posit-dev/positron-beta/discussions/46
foo() +
    bar("<>")

# ---
# Breaking parentheses in a pipeline (comment in the way)
foo() +
    bar("<>") # foo

# ---
# Breaking parentheses in the middle of a pipeline
foo() +
    bar("<>") +
    baz()
