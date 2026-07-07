library(arrow)
Sys.setenv(TZ='GMT')
df2 <- read_parquet(file.path(getwd(), "data-files", "flights", "flights.parquet"))
cat("Number of rows: ", nrow(df2))