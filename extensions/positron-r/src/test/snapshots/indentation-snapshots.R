# File generated from `indentation-cases.R`.

declare(ark(diagnostics(enable = FALSE)))

# ---
# Starting a pipeline (+ operator)
1 +"<>"

# ->
1 +
    "<>"

# ---
# Starting a pipeline (pipe operator)
data |>"<>"

# ->
data |>
    "<>"

# ---
# Starting a pipeline (one empty line)
data |>
    "<>"

# ->
data |>

    "<>"

# ---
# Starting a pipeline (multiple empty lines)
data |>

    "<>"

# ->
data |>


    "<>"

# ---
# Continuing a pipeline
1 +
    2 +"<>"

# ->
1 +
    2 +
    "<>"

# ---
# Continuing a one-liner pipeline
# https://github.com/posit-dev/positron/issues/1316
data |>
    fn() |>"<>"

# ->
data |>
    fn() |>
    "<>"

# ---
# Continuing a one-liner pipeline (trailing whitespace)
# https://github.com/posit-dev/positron/pull/1655#issuecomment-1780093395
data |>
    fn() |> "<>"

# ->
data |>
    fn() |>
    "<>"

# ---
# Continuing a one-liner pipeline (trailing comment)
data |>
    fn() |> "<>" # foo

# ->
data |>
    fn() |>
    "<>"# foo

# ---
# Continuing a one-liner pipeline (comment line)
data |>
    fn1() |>
    # foo"<>"

# ->
data |>
    fn1() |>
    # foo
    "<>"

# ---
# Continuing a one-liner pipeline (after a comment line)
data |>
    fn1() |>
    # foo
    "<>"

# ->
data |>
    fn1() |>
    # foo

    "<>"

# ---
# Continuing a one-liner pipeline (longer pipeline)
data |>
    fn1() |>
    fn2() |>"<>"


# ->
data |>
    fn1() |>
    fn2() |>
    "<>"


# ---
# Continuing a multi-liner pipeline
data |>
    fn1(
        x,
        y
    ) |>"<>"

# ->
data |>
    fn1(
        x,
        y
    ) |>
    "<>"

# ---
# Continuing a multi-liner pipeline (trailing expression)
data |>
    fn1(
        x,
        y
    ) |> "<>" fn2()

# ->
data |>
    fn1(
        x,
        y
    ) |>
    "<>"fn2()

# ---
# Dedent after pipeline
data |>
    fn()"<>"

# ->
data |>
    fn()
"<>"

# ---
# Dedent after pipeline (trailing comment)
data |>
    fn()"<>" # foo

# ->
data |>
    fn()
"<>"# foo

# ---
# Dedent after pipeline (multiple lines)
# https://github.com/posit-dev/positron/issues/2764
data |>
    fn1() |>
    fn2(
        "arg"
    )"<>"

# ->
data |>
    fn1() |>
    fn2(
        "arg"
    )
"<>"

# ---
# Dedent after pipeline (token)
1 +
    foo(
        x
    ) +
    bar"<>"

# ->
1 +
    foo(
        x
    ) +
    bar
"<>"

# ---
# Dedent after pipeline (nested)
{
    1 +
        foo(
            x
        ) +
        bar"<>"
}

# ->
{
    1 +
        foo(
            x
        ) +
        bar
    "<>"
}

# ---
# Stickiness of dedent after pipeline
# https://github.com/posit-dev/positron/issues/1727
data |>
    fn()
"<>"

# ->
data |>
    fn()

"<>"

# ---
# Stickiness of dedent after pipeline (nested)
{
    data |>
        fn()
    "<>"
}

# ->
{
    data |>
        fn()

    "<>"
}

# ---
# Stickiness of dedent after pipeline (nested)
{
    fn() %>%

        foo"<>"
}


# ->
{
    fn() %>%

        foo
    "<>"
}


# ---
# Stickiness of dedent after pipeline (trailing comment)
data |>
    fn()
"<>" # foo

# ->
data |>
    fn()

"<>"# foo

# ---
# Indent after function in call
# FIXME
{
    fn(function() {}"<>")
}

# ->
{
    fn(function() {}
"<>")
}

# ---
# Indent after function in call (multiple lines)
# FIXME
{
    fn(function() {
        #
    }"<>")
}

# ->
{
    fn(function() {
        #
    }
"<>")
}

# ---
# Indent after finished loop (literal)
for (i in NA) NULL"<>"

# ->
for (i in NA) NULL
"<>"

# ---
# Indent after finished loop (call)
# https://github.com/posit-dev/positron/issues/1880
for (i in 1) fn()"<>"

# ->
for (i in 1) fn()
"<>"

# ---
# Breaking parentheses
foo("<>") +
    bar()

# ->
foo(
    "<>"
) +
    bar()

# ---
# Breaking parentheses in a pipeline
# https://github.com/posit-dev/positron/issues/2650
# https://github.com/posit-dev/positron/discussions/46
foo() +
    bar("<>")

# ->
foo() +
    bar(
        "<>"
    )

# ---
# Breaking parentheses in a pipeline (comment in the way)
foo() +
    bar("<>") # foo

# ->
foo() +
    bar(
        "<>"
    ) # foo

# ---
# Breaking parentheses in the middle of a pipeline
foo() +
    bar("<>") +
    baz()

# ->
foo() +
    bar(
        "<>"
    ) +
    baz()

# ---
# Indentation inside braces (function)
# https://github.com/posit-dev/positron/issues/3378
function() {
    foo"<>"
}

# ->
function() {
    foo
    "<>"
}

# ---
# Indentation inside braces (deep)
foo(function() {
    bar"<>"
})

# ->
foo(function() {
    bar
    "<>"
})

# ---
# Indentation of prefixed braces
# https://github.com/posit-dev/positron/issues/3475
# https://github.com/posit-dev/positron/issues/3484
foobar <- function(arg,
                   arg) {"<>"}
# ->
foobar <- function(arg,
                   arg) {
    "<>"
}
