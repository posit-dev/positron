library(arrow)
Sys.setenv(TZ='GMT')
df2 <- read_parquet(file.path(getwd(), "data-files", "largeParquet.parquet"))