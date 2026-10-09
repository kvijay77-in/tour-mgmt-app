ENV ?= dev
export AWS_PROFILE

.PHONY: web-infra web-publish

web-infra:
	bash tools/web.sh infra --env $(ENV)

web-publish:
	bash tools/web.sh publish --env $(ENV) $(if $(DRY_RUN),--dry-run,)
