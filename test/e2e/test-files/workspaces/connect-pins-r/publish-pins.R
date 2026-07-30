# Publishes a couple of pins with dummy data to a Posit Connect server using the
# pins package, then reads them back and prints their contents (the "tables") to
# the console.
#
# Credentials are read from the CONNECT_SERVER and CONNECT_API_KEY environment
# variables, which the e2e test sets on the R session before sourcing this file.
# board_connect() picks these up automatically via its default "auto" auth.
#
# The script is idempotent: it deletes any pins left over from a previous run
# before publishing, so a flaky re-run always starts from a clean slate.

if (!requireNamespace("pins", quietly = TRUE)) {
	install.packages("pins")
}

library(pins)

# The pins we publish. Small slices of the built-in datasets are plenty for
# exercising the publish -> query round trip.
# Each pin carries its storage type. The rds pins exercise the tree; the csv pin is a tabular type
# DuckDB can read, so it exercises the Data Explorer preview. csv is used (not parquet) because it
# needs no extra R package, and pins writes it with row.names = FALSE so its columns are exactly the
# data frame's.
pins_to_publish <- list(
	list(name = "e2e-mtcars", data = head(mtcars, 5), type = "rds"),
	list(name = "e2e-iris", data = head(iris, 5), type = "rds"),
	list(name = "e2e-csv", data = data.frame(id = 1:5, group = letters[1:5], value = c(1.5, 2.5, 3.5, 4.5, 5.5)), type = "csv")
)

board <- board_connect()

# --- Cleanup ---------------------------------------------------------------
# Remove any pins from a previous (possibly failed) run. Wrapped in tryCatch so
# a pin that does not exist -- or a transient lookup error -- never aborts the
# publish that follows.
for (pin in pins_to_publish) {
	tryCatch({
		if (pin_exists(board, pin$name)) {
			pin_delete(board, pin$name)
			cat("Deleted existing pin:", pin$name, "\n")
		}
	}, error = function(e) {
		cat("Cleanup skipped for", pin$name, ":", conditionMessage(e), "\n")
	})
}

# --- Publish ---------------------------------------------------------------
for (pin in pins_to_publish) {
	pin_write(board, pin$data, name = pin$name, type = pin$type)
	cat("Published pin:", pin$name, "(", pin$type, ")\n")
}

# Publish a second version of one pin (board_connect() is versioned by default), so the
# tree shows multiple version nodes and the newest write becomes the active version.
pin_write(board, head(mtcars, 8), name = "e2e-mtcars", type = "rds")
cat("Published second version of pin: e2e-mtcars\n")

# --- Query -----------------------------------------------------------------
# Read each pin back and log its table contents to the console.
for (pin in pins_to_publish) {
	cat("\n==== Pin contents:", pin$name, "====\n")
	print(pin_read(board, pin$name))
}

cat("\nPINS PUBLISH COMPLETE\n")
