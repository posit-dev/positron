path <- dbplyr::nycflights13_sqlite(path = "db/")

library(DBI)
con <- dbConnect(
  RSQLite::SQLite(),
  dbname = "db/nycflights13.sqlite",
  bigint = "integer64"
)
connections::connection_view(con)
