#!/bin/sh
set -eu
# Only reload the project container after successful config validation.
docker exec project-probe-web nginx -t
docker exec project-probe-web nginx -s reload
