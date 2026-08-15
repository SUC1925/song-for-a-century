# Putting the site on GitHub Pages

This folder is the website. Upload it as it is:

    index.html      the page
    support.js      the runtime it loads
    assets/         drawings, emblem, QR code, poster images

## 1. Make the repository
1. Sign in at github.com, click **+** (top right) > **New repository**.
2. Name it `song-for-a-century`, keep it **Public**, tick nothing else, **Create repository**.

## 2. Upload the folder
1. On the empty repository page click **uploading an existing file**.
2. Drag in `index.html`, `support.js` and the whole `assets` folder together.
3. **Commit changes**.

## 3. Switch Pages on
1. **Settings** > **Pages** in the left sidebar.
2. Source: **Deploy from a branch**. Branch **main**, folder **/ (root)**. **Save**.
3. Wait a minute and reload. The live address appears at the top:
   `https://YOUR-USERNAME.github.io/song-for-a-century/`

That address is your **siteUrl**.

## 4. Put the address into the page
Two meta tags are waiting for it. On GitHub open `index.html`, click the pencil,
press Ctrl+F and search for `SITE-URL-HERE`. Replace both with your address
(no slash at the end), e.g.

    https://YOUR-USERNAME.github.io/song-for-a-century

Commit. WhatsApp and Facebook now show the poster when the link is shared.
WhatsApp caches previews, so if the old bare link still appears, share it once
with `?v=2` on the end.

Also paste the address into the page's **siteUrl** setting before you ask me for
the next export, so the share buttons and the calendar link use it.

## 5. A shorter address, optional
A domain such as `songforacentury.co.za` runs about R150 a year at domains.co.za
or Namecheap. **Settings** > **Pages** > **Custom domain**, enter it, then point the
DNS at GitHub. Not needed to go live.

## Updating later
Ask me for a fresh export, then on GitHub use **Add file** > **Upload files** and drop
the new `index.html` in. It replaces the old one; the assets stay.

## Still to fill in
- The Apps Script URL for the booking form (see `../apps-script/README.md`).
- Anika's email address.
- The programme, both bios, the organ description and the church history.
