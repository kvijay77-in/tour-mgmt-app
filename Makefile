ENV ?= dev
CONFIG ?= tools/web-deployment.$(ENV).json
AWS_PROFILE ?=
GITHUB_CONFIG_REPLACE ?= false
SOURCE_REF ?= HEAD
RELEASE_ID ?=
LOCK_OWNER ?=
RECOVERY_REASON ?=
STAGE ?= all

export AWS_PROFILE

GITHUB_CONFIG_FLAGS = $(if $(filter true,$(GITHUB_CONFIG_REPLACE)),--replace-github-vars,)

.PHONY: web-setup deploy-dev deploy-prod web-status web-rollback web-lock-recover

web-setup:
	bash tools/web-deploy.sh setup --env "$(ENV)" --config "$(CONFIG)" $(GITHUB_CONFIG_FLAGS)

deploy-dev: ENV = dev
deploy-dev:
	bash tools/web-deploy.sh deploy --env dev --config "$(CONFIG)" --source-ref "$(SOURCE_REF)" --stage "$(STAGE)"

deploy-prod: ENV = prod
deploy-prod:
	bash tools/web-deploy.sh deploy --env prod --config "$(CONFIG)" --source-ref "$(SOURCE_REF)" --stage "$(STAGE)"

web-status:
	bash tools/web-deploy.sh status --env "$(ENV)" --config "$(CONFIG)"

web-rollback:
	bash tools/web-deploy.sh rollback --env "$(ENV)" --config "$(CONFIG)" --release-id "$(RELEASE_ID)"

web-lock-recover:
	bash tools/web-deploy.sh recover-lock --env "$(ENV)" --config "$(CONFIG)" --expected-owner "$(LOCK_OWNER)" --reason "$(RECOVERY_REASON)"