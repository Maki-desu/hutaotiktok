#!/bin/sh
set -eu

node /usr/local/bin/hutaotik-cobalt-write-keys.mjs
exec "$@"
