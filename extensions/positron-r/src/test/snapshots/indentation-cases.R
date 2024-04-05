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
1 +"<>"

# ---
1 +
	2 +"<>"

# ---
data |>"<>"

# ---
data |>
	fn()"<>"

# ---
# https://github.com/posit-dev/positron/issues/1727
# FIXME
data |>
	fn()
"<>"

# ---
# https://github.com/posit-dev/positron/issues/1316
data |>
	fn() |>"<>"

# ---
# With trailing whitespace
# https://github.com/posit-dev/positron/pull/1655#issuecomment-1780093395
data |>
	fn() |> "<>"

# ---
data |>
	fn1() |>
	fn2() |>"<>"

# ---
# FIXME
data |>
	fn1() |>
	fn2(
		"arg"
	)"<>"

# ---
# https://github.com/posit-dev/positron-beta/discussions/46
# FIXME
data |>
	fn("<>")

# ---
# FIXME
{
	fn(function() {}"<>")
}

# ---
# FIXME
{
	fn(function() {
		#
	}"<>")
}

# ---
for (i in NA) NULL"<>"

# ---
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
