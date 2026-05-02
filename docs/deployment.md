# Deployment

Lingadoo is a static Vite app. A production deployment should serve only the files produced by `npm run build`.

## GitHub Pages

The included workflow builds and deploys `dist/` on pushes to `main`.

Optional repository variables:

- `VITE_GA_MEASUREMENT_ID`: GA4 measurement id. Leave unset to disable Google Analytics.
- `VITE_GA_REQUIRE_CONSENT`: set to `true` when the deployment should wait for `localStorage["lingadoo.analytics.consent"] === "granted"` before loading GA.
- `PAGES_CUSTOM_DOMAIN`: custom domain to write into `dist/CNAME`, for example `lingadoo.app`.

`public/CNAME` is intentionally not committed. This keeps forks from inheriting the official domain.

When `VITE_GA_REQUIRE_CONSENT=true`, the deployment is responsible for showing any required consent UI and writing `granted` to `localStorage["lingadoo.analytics.consent"]` before reloading or initializing analytics.

## Source Link

The Pages workflow sets `VITE_SOURCE_URL` to `https://github.com/${{ github.repository }}`. Other hosts should set `VITE_SOURCE_URL` to the public source repository URL.

## Privacy

Do not add deployment services that receive uploaded PDFs, filenames, extracted text, translations, block ids, or edited content unless the privacy policy is updated and users explicitly opt into that behavior.
