
.PHONY: all

SYNTAX_SOURCES := $(wildcard syntaxes/*.src.json)
SYNTAX_OUTPUTS := $(subst src,gen,$(SYNTAX_SOURCES))

all: $(SYNTAX_OUTPUTS)

syntaxes/%.gen.json: syntaxes/%.src.json
	@Rscript scripts/compile-syntax.R $< $@
