#!/usr/bin/env sh
set -eu

BASE_URL="${1:-http://localhost:8787}"
case "$BASE_URL" in
  ws://*)
    BASE_URL="http://${BASE_URL#ws://}"
    ;;
  wss://*)
    BASE_URL="https://${BASE_URL#wss://}"
    ;;
esac

response="$(curl -fsS "$BASE_URL/health")"
case "$response" in
  *'"ok":true'*)
    printf 'health ok: %s\n' "$BASE_URL"
    ;;
  *)
    printf 'unexpected health response: %s\n' "$response" >&2
    exit 1
    ;;
esac
