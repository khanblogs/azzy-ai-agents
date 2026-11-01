COMPOSE ?= docker compose -f infra/docker-compose.yml
ENV_FILE := infra/.env

.PHONY: help env up down restart logs ps build test test-web test-api e2e e2e-mobile backup restore tls update deploy install-docker migrate screenshots clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

env: ## Create infra/.env from the example (no-op if it exists)
	@if [ -f $(ENV_FILE) ]; then echo "$(ENV_FILE) exists"; else cp infra/.env.example $(ENV_FILE) && echo "wrote $(ENV_FILE)"; fi

up: env ## Build and start the whole stack (http://localhost)
	$(COMPOSE) up -d --build

down: ## Stop the stack (keeps volumes)
	$(COMPOSE) down --remove-orphans

restart: ## Restart api + worker + web (after editing infra/.env)
	$(COMPOSE) up -d --force-recreate api worker web

logs: ## Tail logs (SERVICE=api to narrow)
	$(COMPOSE) logs -f --tail=200 $(SERVICE)

ps: ## Service status
	$(COMPOSE) ps

build: ## Rebuild images without starting
	$(COMPOSE) build

test: test-web test-api ## Typecheck + lint + build web, pytest api

test-web: ## npm typecheck, lint, build
	npm run typecheck
	npm run lint
	npm run build

test-api: ## pytest for the API/policy/orchestrator
	pytest apps/api -q

e2e: ## Playwright e2e against E2E_BASE_URL (default http://localhost)
	npm run e2e

e2e-mobile: ## Only the mobile viewport project
	npm run e2e -- --project=mobile

screenshots: ## Regenerate e2e/screenshots (desktop + mobile)
	npm run e2e -- --grep screenshots

backup: ## pg_dump -> local + S3 (BACKUP_BUCKET from infra/.env)
	bash infra/scripts/backup.sh

restore: ## Restore a dump: make restore FILE=/var/backups/azzy/azzy-...sql.gz (or FILE=--latest)
	bash infra/scripts/restore.sh $(FILE)

tls: ## Enable HTTPS: make tls DOMAIN=azzy.example.com EMAIL=you@example.com
	sudo bash infra/scripts/enable_tls.sh $(DOMAIN) $(EMAIL)

update: ## git pull + rebuild + health wait (same as deploy.sh)
	bash infra/scripts/deploy.sh

deploy: update ## Alias of update (what CI runs over SSM)

install-docker: ## Prepare a fresh Ubuntu/Debian/AL2023 VM (docker, compose, swap)
	sudo bash infra/scripts/install-docker.sh

migrate: ## Run alembic upgrade head inside the api container
	$(COMPOSE) exec -T api alembic upgrade head

clean: down ## Stop and delete volumes (DESTROYS DATA)
	$(COMPOSE) down -v --remove-orphans
