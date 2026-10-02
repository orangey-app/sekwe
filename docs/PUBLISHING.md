# Publishing Sekwe

Sekwe lives at <https://orangey-app.github.io/sekwe/>, beside Orangey at
<https://orangey-app.github.io/orangey/>, built from the repository
`orangey-app/sekwe`. Every push to `main` rebuilds and redeploys it.

**Why beside Orangey:** a browser keeps each site's storage apart, and both
apps are on the one site `orangey-app.github.io`. So Sekwe can read the
Orangey library you made there, with no server and no account. Published
anywhere else, Sekwe would still work (dice, journals, files, a journal's own
copy of its folders) but would not see that library.

Nothing needs configuring for the address: every path in `dist/` is relative,
and the offline worker only touches caches named `sekwe-…` (Orangey's worker
only touches `orangey-v…`), so neither app's update clears the other's offline
copy.

## First time

1. Create the repository `sekwe` in the **orangey-app** organisation, public,
   with nothing pre-added — no README, no licence, no `.gitignore`.
2. In this folder:

   ```
   git branch -M main
   git remote add origin https://github.com/orangey-app/sekwe.git
   git push -u origin main
   ```

3. On github.com, open the repository → **Settings → Pages → Build and
   deployment → Source: GitHub Actions**.
4. **Actions → Deploy to GitHub Pages → Run workflow.** A run that fired on the
   push before Pages was switched on will have failed; ignore it. When the run
   is green the app is live at <https://orangey-app.github.io/sekwe/>.
5. Add Sekwe to the landing page in the `orangey-app.github.io` repository.

`pages-build-deployment` is GitHub's own Jekyll pipeline and appears only while
Source is set to a branch. If you see it, the Source setting has not taken.

## Afterwards

Commit, `git push`, wait for the Actions tab to go green. A hard refresh
(Ctrl+F5) skips the offline worker's cached copy.

**CI** (`ci.yml`) checks out Orangey beside Sekwe, builds it, and runs
everything: `check` (vendor/orangey unedited), typecheck, unit tests, build,
and the browser tests, including the one that rolls a wheel made in Orangey's
own build. It also prints `sync:status`, so you can see when Orangey has moved
on since the last `npm run sync`; that never fails the run.

## A release

```
git tag v0.1.0
git push origin v0.1.0
```

`release.yml` builds, tests, and attaches `sekwe.html` (the whole app in one
file) and a ZIP of the static site to a GitHub release with generated notes.
