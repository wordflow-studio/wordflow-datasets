cli := "bun run ./src/cli.ts"
fixture := "./datasets/editorial-sample"

smoke: smoke-bad-refs smoke-help smoke-missing-body smoke-missing-manifest smoke-missing-path smoke-valid

smoke-bad-refs:
  #!/usr/bin/env bash
  set -euo pipefail
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT
  cp -R {{fixture}} "$tmpdir/editorial-sample"
  ITEM_PATH="$tmpdir/editorial-sample/content/post/company-update/item.json" bun -e 'const path = process.env.ITEM_PATH; if (!path) throw new Error("ITEM_PATH is required"); const item = JSON.parse(await Bun.file(path).text()); item.sourceRefs = ["missing-source"]; item.taxonomyRefs = ["category:missing-term"]; await Bun.write(path, `${JSON.stringify(item, null, 2)}\n`);'
  if {{cli}} validate "$tmpdir/editorial-sample"; then
    echo "expected invalid dataset for bad refs"
    exit 1
  else
    status=$?
    if [ "$status" -ne 1 ]; then
      echo "expected exit code 1, got $status"
      exit 1
    fi
  fi

smoke-help:
  {{cli}} --help

smoke-missing-body:
  #!/usr/bin/env bash
  set -euo pipefail
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT
  cp -R {{fixture}} "$tmpdir/editorial-sample"
  rm "$tmpdir/editorial-sample/content/post/company-update/body.md"
  if {{cli}} validate "$tmpdir/editorial-sample"; then
    echo "expected invalid dataset for missing body"
    exit 1
  else
    status=$?
    if [ "$status" -ne 1 ]; then
      echo "expected exit code 1, got $status"
      exit 1
    fi
  fi

smoke-missing-manifest:
  #!/usr/bin/env bash
  set -euo pipefail
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT
  cp -R {{fixture}} "$tmpdir/editorial-sample"
  rm "$tmpdir/editorial-sample/dataset.json"
  if {{cli}} validate "$tmpdir/editorial-sample"; then
    echo "expected invalid dataset for missing manifest"
    exit 1
  else
    status=$?
    if [ "$status" -ne 1 ]; then
      echo "expected exit code 1, got $status"
      exit 1
    fi
  fi

smoke-missing-path:
  #!/usr/bin/env bash
  set -euo pipefail
  if {{cli}} validate ./datasets/missing-dataset; then
    echo "expected unreadable dataset for missing path"
    exit 1
  else
    status=$?
    if [ "$status" -ne 2 ]; then
      echo "expected exit code 2, got $status"
      exit 1
    fi
  fi

smoke-valid:
  {{cli}} validate {{fixture}}
