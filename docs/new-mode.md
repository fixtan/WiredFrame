# 新しいモードの作り方

## 1. モードの実装
`src/modes/` に `IMode`（`src/core/IMode.ts`）を実装したクラスを置く。
- `init(scene, camera, renderer?)` / `update(delta, time)` / `dispose()` は必須。`dispose` で GPU 資源（geometry・material・texture・render target）を必ず解放する。
- `setBrightness(percent)` を実装すると、パネルの「明るさ」が効く（ガンマ 2.2 の倍率 `(percent/100)^2.2` を色に掛ける。`NoiseMode1` 参照）。
- `onResize()` は、画面サイズに依存する値の更新用。

## 2. モード名の登録
- `src/settings.ts` の `MODES` にモード名を足す。
- `index.html` の `#select-mode` に `<option>` を足す。
- `src/main.ts` の `applyToMode` で、モード名からインスタンスを作る分岐を足す。

## 3. 調整パラメータ（任意）
1. `src/modes/params.ts` に `ParamDef[]`（key・label・min・max・step・default）を書き、`MODE_PARAMS` に登録する。
2. モードで `setParams(values)` を実装する。`clampParams(defs, values)` を通すと、不足は既定値・範囲外は丸めで安全に使える。いつ呼ばれてもその場で反映すること（`init` の前に呼ばれてもよいように値を保持する）。
3. 設定パネルの「詳細な調整」にスライダーが自動で出る。保存・プレビュー・初期値に戻す・保存値の検証は共通処理で動く（`settings.ts` の `modeParams`）。

## 3b. 重いモード向けの仕組み
- `getRenderScale()` を実装すると、描画解像度を下げられる（パラメータの値を返す）。
- `render(renderer)` を実装すると、描画を自前で行える（ポストエフェクト用）。
- モードを切り替えると、描画解像度は 1 に戻る。

## 4. 設定パネル
- 後ろの画面を見ながら調整できるよう、パネルの背景は暗くもぼかしもしない。
- タイトルをドラッグすると動かせる（ダブルクリックで中央に戻る）。画面外に出ないよう、タイトルが見える範囲に収める。

## 5. 確認
- `docs/debug-tools.md` の手順に、そのモードの確認を足す。
- 負荷（GPU・FPS）を `docs/` に書く。モニターを複数使うので、重いモードは粒子数や FPS 上限のような設定を用意する。
