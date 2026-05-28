#!/usr/bin/env bash
set -euo pipefail

DATASET="lmarena-ai/leaderboard-dataset"
OUT_DIR="${1:-data/raw/lmarena-leaderboard}"
API_URL="https://huggingface.co/api/datasets/${DATASET}"
RESOLVE_URL="https://huggingface.co/datasets/${DATASET}/resolve/main"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required. Install jq and rerun this script." >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

echo "Saving dataset metadata..."
curl -fsSL "${API_URL}" -o "${OUT_DIR}/dataset-api-metadata.json"

echo "Downloading parquet files into ${OUT_DIR}..."
curl -fsSL "${API_URL}" \
  | jq -r '.siblings[].rfilename | select(endswith(".parquet"))' \
  | while read -r file; do
      mkdir -p "${OUT_DIR}/$(dirname "${file}")"
      echo "  ${file}"
      curl -fL --retry 3 --retry-delay 2 \
        "${RESOLVE_URL}/${file}" \
        -o "${OUT_DIR}/${file}"
    done

echo "Done."

