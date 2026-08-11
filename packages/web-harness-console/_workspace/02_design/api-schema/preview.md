# Preview origin

`GET http://127.0.0.1:<previewPort>/:projectId/*` serves only that project's `_workspace/02_design/preview/` files with realpath containment and no directory listing.

- methods: GET/HEAD only
- Console과 별도 localhost origin
- path traversal, missing project/asset, mutation method는 typed 4xx
