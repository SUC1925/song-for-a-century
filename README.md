# Putting the site on GitHub Pages

This folder is the website. Upload it as it is:

    index.html      the page
    support.js      the runtime it loads
    assets/         drawings, emblem, QR code, poster images

Live at https://suc1925.github.io/song-for-a-century/ from the repository
`SUC1925/song-for-a-century`, branch `main`, folder `/ (root)`.

## Updating the site
1. On GitHub open the repository, **Add file** > **Upload files**.
2. Drag in `index.html`, `support.js` and the whole `assets` folder together.
3. **Commit changes**. Pages redeploys in about a minute.

Everything the page needs is already baked in: the booking endpoint, the site
address in the share links and calendar file, and the poster download. There is
nothing left to search and replace.

WhatsApp caches link previews. If an old preview still shows after an update,
share the link once with `?v=2` on the end.

## Making the repository from scratch, if ever needed
1. github.com, **+** (top right) > **New repository**.
2. Name it `song-for-a-century`, **Public**, create it.
3. **uploading an existing file**, drag in the three items above, commit.
4. **Settings** > **Pages**: source **Deploy from a branch**, branch **main**,
   folder **/ (root)**, **Save**.

If the address changes, tell me: the QR codes on the poster and the social posts
encode it and have to be regenerated, and the Apps Script `SITE_URL` has to match.

## A shorter address, optional
A domain such as `songforacentury.co.za` runs about R150 a year. **Settings** >
**Pages** > **Custom domain**, then point the DNS at GitHub. Not needed to go live.

## Still to fill in
- The office email address for booking notifications (`apps-script/README.md`).
- The programme, both bios, the organ description and the church history.
