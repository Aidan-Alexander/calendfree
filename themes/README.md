# Themes

A copy of Calendfree for an organisation can use its own branding. Make a folder here, say `themes/acme/`, with:

- `theme.css` (required): loaded after `style.css`, so it can change the colours, fonts and shapes. The colours are CSS variables at the top of `public/style.css`.
- `logo.png` (optional): shown, centred, above every page.
- `icon.png` (optional): the browser tab icon.
- `theme.json` (optional): `{ "name": "Acme", "url": "https://acme.org" }`, the logo's alt text and where it links.

Then set `THEME=acme` on that copy's Netlify site and publish it again. Theme folders are kept out of git (see `.gitignore`), so an organisation's logo and fonts never end up in the public repo.
