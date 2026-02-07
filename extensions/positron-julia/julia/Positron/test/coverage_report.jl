# Simple coverage report
using Coverage

cov = process_folder("src")
covered, total = get_summary(cov)

println("=" ^ 70)
println("Code Coverage Report")
println("=" ^ 70)
println("\nOverall: $covered/$total lines = $(round(covered/total*100, digits=1))%")

println("\nPer-file coverage:")
println("-" ^ 70)

files = [
    "variables.jl",
    "help.jl",
    "data_explorer.jl",
    "plots.jl",
    "ui.jl",
    "comm.jl",
    "jsonrpc.jl",
    "kernel.jl",
]

for file in files
    file_cov = filter(x -> endswith(x.filename, file), cov)
    if !isempty(file_cov)
        # Coverage.jl stores per-line coverage counts in a vector, with `nothing` for non-code
        entries = [c for fc in file_cov for c in getfield(fc, :coverage) if c !== nothing]
        covered_lines = count(x -> x > 0, entries)
        total_lines = length(entries)
        pct = round(covered_lines/total_lines*100, digits = 1)
        status = pct > 70 ? "✅" : (pct > 40 ? "🟡" : "❌")
        println("$status $file: $covered_lines/$total_lines ($pct%)")
    end
end

println("\n" * "=" ^ 70)
println("Focus testing on ❌ and 🟡 files")
