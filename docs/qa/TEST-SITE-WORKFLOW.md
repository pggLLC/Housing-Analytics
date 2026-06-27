# Test-site build and sync

The public GitHub Pages artifact and the password-gated Cloudflare Worker are
two outputs from the same `Housing-Analytics` source checkout.

## Public site

```bash
npm run build:public
npm run audit:public-artifact
```

The public build excludes developer pages, pipeline data, curated jurisdiction
briefs, verification files, and private JavaScript. It also generates the
search index, complete sitemap, and structured data from the files that
actually entered `dist/`.

## Gated test site

```bash
npm run build:gated-test
```

This invokes `~/coho-backend/build-bundle.sh` with the current public checkout
as its source. The backend build:

1. rebuilds the public artifact;
2. copies shared public assets;
3. adds only the gated pages, pipeline files, and published brief JSON;
4. records the source Git revision in `public/.coho-build.json`; and
5. verifies hashes for every gated source file before it succeeds.

Set `COHO_BACKEND_REPO=/path/to/coho-backend` when the backend checkout is not
at `~/coho-backend`.

Deploy only after the build succeeds:

```bash
cd ~/coho-backend
./deploy-test.sh /path/to/Housing-Analytics
```

No paid GitHub features or additional hosting services are required.
