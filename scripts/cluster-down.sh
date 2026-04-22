#!/usr/bin/env bash
set -euo pipefail
CLUSTER=${CLUSTER:-code2k8s}
k3d cluster delete "${CLUSTER}"
