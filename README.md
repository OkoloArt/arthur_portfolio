# Arthur Okolo Portfolio — Production Build

This is a static HTML/CSS/JavaScript portfolio. There is **no build step** and no framework dependency.

## Structure

```text
.
├── index.html
├── css/
│   └── styles.css
├── js/
│   └── app.js
├── assets/
│   ├── Arthur_Okolo_CV.pdf
│   ├── favicon.svg
│   └── og-image.png
├── _headers
├── robots.txt
├── sitemap.xml
└── site.webmanifest
```

## Run locally

From this folder:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

Do not rely on double-clicking `index.html` for final QA because clipboard and some browser APIs behave differently on `file://` URLs.

## Deploy

### Cloudflare Pages
1. Push this folder to a GitHub repository.
2. In Cloudflare Pages, connect the repository.
3. Framework preset: **None**.
4. Build command: leave blank.
5. Build output directory: `/` (repository root).
6. Deploy.

### Vercel
Import the GitHub repository as a static project. No framework or build command is required.

### GitHub Pages
Publish the repository root from the `main` branch.

## Track URLs

The portfolio supports:

```text
?track=backend
?track=android
```

The "Copy Backend link" / "Copy Android link" button builds the URL from the live deployment automatically, so it does not need a hardcoded deployment hostname.

## Current production URL

The current canonical/SEO URL is:

```text
https://portfolio.okoloarthur4.workers.dev/
```

The current production metadata is configured for this URL. If you later connect a custom domain, update it in these places:

- `index.html` canonical link
- `index.html` `og:url`
- `index.html` `og:image`
- `index.html` `twitter:image`
- JSON-LD `url`
- `robots.txt`
- `sitemap.xml`

The application itself does **not** need changing for track sharing.

## Production notes

- Dark mode is the first-visit default.
- A visitor's explicit theme choice is stored locally and respected.
- The résumé is a normal PDF asset rather than Base64 embedded in the HTML.
- CSS and JavaScript are external files for maintainability and browser caching.
- The Interactive System Lab remains entirely client-side.
