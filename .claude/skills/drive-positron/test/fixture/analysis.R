# drive-positron smoke fixture: a few lines to run, step through and plot.
values <- c(3, 1, 4, 1, 5, 9, 2, 6)
double_it <- function(n) {
	twice <- n * 2
	twice + 0
}
total <- sum(double_it(values))
cat("smoke-total", total, "\n")
