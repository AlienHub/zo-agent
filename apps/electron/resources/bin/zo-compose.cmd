@echo off
set HTTP_PROXY=
set HTTPS_PROXY=
set ALL_PROXY=
set http_proxy=
set https_proxy=
set all_proxy=
set NO_PROXY=*
set no_proxy=*
"%CRAFT_BUN%" run "%CRAFT_COMPOSE_CLI_ENTRY%" %*
