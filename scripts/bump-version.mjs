// バージョンを一括で上げる。使い方: npm run bump -- 0.1.2
// 書き換えるのは Cargo.toml / Cargo.lock / package.json / package-lock.json の 4 つ。
// tauri.conf.json には version を書かない（無いときは Cargo.toml の値が使われる）。
import fs from 'node:fs';

const v = process.argv[2];
if (!v || !/^\d+\.\d+\.\d+$/.test(v)) {
  console.error('使い方: npm run bump -- 0.1.2');
  process.exit(1);
}

function edit(file, fn) {
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after === before) {
    console.error(`変更なし（すでに同じ値、または見つからない）: ${file}`);
    return;
  }
  fs.writeFileSync(file, after);
  console.log(`更新: ${file}`);
}

// [package] の version だけを書き換える（依存の version は触らない）
edit('src-tauri/Cargo.toml', (s) => s.replace(/(\[package\][\s\S]*?\nversion = )"[^"]*"/, `$1"${v}"`));
// Cargo.lock の自分自身（name = "app"）
edit('src-tauri/Cargo.lock', (s) => s.replace(/(name = "app"\nversion = )"[^"]*"/, `$1"${v}"`));
edit('package.json', (s) => s.replace(/("version": )"[^"]*"/, `$1"${v}"`));
edit('package-lock.json', (s) =>
  s.replace(/("name": "wiredframe",\n\s*"version": )"[^"]*"/g, `$1"${v}"`),
);

console.log(`\nバージョンを ${v} にしました。次: npm run tauri build → git tag v${v} → git push origin v${v} → gh release create`);
