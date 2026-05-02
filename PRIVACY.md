# Privacy

Lingadoo processes uploaded PDFs locally in the browser. Uploaded documents are not sent to a Lingadoo server by the static app.

The app can be deployed with Google Analytics by setting `VITE_GA_MEASUREMENT_ID` during a production build. Analytics is disabled by default.

Analytics events must not include:

- uploaded document contents
- filenames
- extracted text
- translations
- block ids
- edited content

If you deploy Lingadoo publicly, configure consent and privacy disclosures appropriate for your jurisdiction.
