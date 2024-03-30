# File generated from `indentation-cases.R`.

# --- 
1 +
  "<>"

# --- 
1 +
	2 +
	"<>"

# --- 
data |>
  "<>"

# --- 
data |>
	fn()
"<>"

# --- 
# https://github.com/posit-dev/positron/issues/1727
# FIXME
data |>
	fn()

	"<>"

# --- 
# https://github.com/posit-dev/positron/issues/1316
data |>
	fn() |>
	"<>"

# --- 
# With trailing whitespace
# https://github.com/posit-dev/positron/pull/1655#issuecomment-1780093395
data |>
	fn() |> 
	"<>"

# --- 
data |>
	fn1() |>
	fn2() |>
	"<>"

# --- 
# FIXME
data |>
	fn1() |>
	fn2(
		"arg"
	)
	"<>"

# --- 
# https://github.com/posit-dev/positron-beta/discussions/46
# FIXME
data |>
	fn(
"<>")

# --- 
# FIXME
{
	fn(function() {}
"<>")
}

# --- 
# FIXME
{
	fn(function() {
		#
	}
"<>")
}

# --- 
for (i in NA) NULL
"<>"

# --- 
# https://github.com/posit-dev/positron/issues/1880
# FIXME
for (i in 1) fn()
  "<>"
