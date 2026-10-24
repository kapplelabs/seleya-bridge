# seleya-bridge: the CLI (repo root) and the macOS menu-bar app (app/).
# `make help` lists the targets.

PNPM ?= pnpm
APP  := app

# pnpm writes .modules.yaml on every install, so it tracks whether node_modules matches the lockfile.
ROOT_DEPS := node_modules/.modules.yaml
APP_DEPS  := $(APP)/node_modules/.modules.yaml

.DEFAULT_GOAL := help

.PHONY: help install dev build start lint test check \
        app-install app-dev app-build app-start app-lint app \
        all clean

help: ## List the targets
	@awk 'BEGIN { FS = ":.*## " } /^[a-zA-Z_-]+:.*## / { printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

$(ROOT_DEPS): package.json pnpm-lock.yaml
	$(PNPM) install --frozen-lockfile
	@touch $@

# The app bundles ../src, zod and the Agent SDK from the root, so the root install comes first.
$(APP_DEPS): $(APP)/package.json $(APP)/pnpm-lock.yaml $(ROOT_DEPS)
	cd $(APP) && $(PNPM) install --frozen-lockfile
	@touch $@

## CLI

install: $(ROOT_DEPS) ## Install the CLI's dependencies

dev: $(ROOT_DEPS) ## Run the bridge from src/ with --watch
	$(PNPM) dev

build: $(ROOT_DEPS) ## Compile the CLI into dist/
	$(PNPM) build

start: build ## Build, then run the compiled bridge
	$(PNPM) start

lint: $(ROOT_DEPS) ## Type-check the CLI
	$(PNPM) lint

test: $(ROOT_DEPS) ## Run the CLI's tests
	$(PNPM) test

check: lint test app-lint ## Type-check both, run the tests

## macOS app

app-install: $(APP_DEPS) ## Install the app's dependencies (and the root's)

app-dev: $(APP_DEPS) ## Run the app with the panel hot-reloading
	cd $(APP) && $(PNPM) dev

app-build: $(APP_DEPS) ## Build the app's main, preload and renderer into app/dist/
	cd $(APP) && $(PNPM) build

app-start: app-build ## Build, then open the app with Electron
	cd $(APP) && $(PNPM) start

app-lint: $(APP_DEPS) ## Type-check the app
	cd $(APP) && $(PNPM) lint

app: $(APP_DEPS) ## Package app/release/Seleya Bridge-<version>-<arch>.dmg (unsigned)
	cd $(APP) && $(PNPM) dist

## Both

all: build app ## Build the CLI and the .dmg

clean: ## Remove build output (dist/, app/dist/, app/release/)
	rm -rf dist $(APP)/dist $(APP)/release
