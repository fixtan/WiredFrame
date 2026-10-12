# リリース手順

## バージョンの上げ方

`npm run bump -- 0.1.2`（`scripts/bump-version.mjs`）。次の 4 つを一括で書き換える。

- `src-tauri/Cargo.toml`（`[package]` の version。**これが基準**）
- `src-tauri/Cargo.lock`（`name = "app"` の項目）
- `package.json`
- `package-lock.json`

`src-tauri/tauri.conf.json` には `version` を書かない。書いていないと、Tauri は `Cargo.toml` の値を使う（インストーラーのファイル名にも反映される。`WiredFrame_<version>_x64-setup.exe`）。

## 公開まで

```
npm run bump -- 0.1.2
# RELEASE_NOTES_v0.1.2.md を書く（修正・追加・改善・インストール）。公開後に削除する
npm run tauri build
git add -A
git commit -m "chore: v0.1.2"
git push
git tag v0.1.2
git push origin v0.1.2
gh release create v0.1.2 "src-tauri\target\release\bundle\nsis\WiredFrame_0.1.2_x64-setup.exe" --title "WiredFrame v0.1.2" --notes-file RELEASE_NOTES_v0.1.2.md
```

- タグは、ビルドした内容を push したあとに打つ（タグが指すコミットと、添付する exe を一致させるため）。
- リリース文は、前のバージョンのものを写して書く。`RELEASE_NOTES_*.md` は公開後に消すので、`gh release view v0.2.0` か GitHub のリリースページから取る。
- 公開後、ルートの `RELEASE_NOTES_*.md` は `git rm` して消す（リリース文は GitHub 側に残る）。
- インストーラーに署名はない（SmartScreen の警告が出る）。
- 紹介ページ（project104）の更新履歴・タイトルの版数も合わせて直す。

## メモ

- v0.1.1 までは tauri.conf.json にも version を書いていたが、v0.1.2 の準備で外した（bump の対象を減らすため）。外したあとの初回ビルドで、インストーラーのファイル名の版数が `Cargo.toml` と一致していることを確認する。
