# Run the headless kernel + the TUI viewer.
# The kernel resolves the model from ~/.along/agent/settings.json ("defaultModel")
# and the API key from the provider's env var, e.g.:  export DEEPSEEK_API_KEY=sk-...
BIN := $(CURDIR)/bin

.PHONY: kernel tui run clean
kernel:
	go build -o $(BIN)/along ./cmd/along
tui: kernel
	cd cmd/tui && go run . --along-path $(BIN)/along
run: tui
clean:
	rm -rf $(BIN)
