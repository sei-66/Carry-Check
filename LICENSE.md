# 第三者ライセンス通知

## CarryCheck 独自コードの扱い

本書は CarryCheck が使用する第三者ソフトウェアの通知です。CarryCheck 独自コードの利用許諾は変更せず、本書によって新たな利用許諾を付与しません。以下のライセンスは、それぞれの第三者ソフトウェアに適用されます。

## 配信物に含む通知

ビルドした配信物では、本書 `LICENSE.md` と、自動生成される `THIRD_PARTY_LICENSES.md` を併せて参照してください。両方のファイルを配信物に同梱します。

- `THIRD_PARTY_LICENSES.md`: JavaScript にバンドルされた依存の名称・バージョン・ライセンス全文。React、Three.js、Radix、Lucide、class-variance-authority 等を、Vite の `build.license` で実際のバンドルから収集します。Lucide の Feather 由来アイコンに関する通知も全文に含みます。
- 本書: JavaScript 依存の自動収集対象外となる、生成 CSS、管理下の UI ソース、Vite が挿入するブラウザ実行コードの通知。

ソースから配信物を作る場合は `npm ci`、`npm run build` を実行してください。生成先は `dist/` です。第三者ソフトウェアを更新・追加した場合は、生成した通知と、以下の手動で管理する通知を確認してください。開発専用ツールのライセンスは各インストール済みパッケージ内のファイルを参照してください。

## Tailwind CSS 4.3.3

`src/style.css` から生成 CSS に含めています。

出典: [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss/blob/v4.3.3/LICENSE)

```text
MIT License

Copyright (c) Tailwind Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## shadcn/ui

`src/components/ui/` に取り込んだ UI ソースに適用します。開発用 CLI 自体を製品にバンドルするものではありません。

出典: [shadcn-ui/ui](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md)

```text
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Vite 8.3.5 のブラウザ実行コード

Vite が生成物に挿入する modulepreload の補助コード等に適用します。開発サーバー自体を製品として配信するものではありません。

出典: [vitejs/vite](https://github.com/vitejs/vite/blob/v8.3.5/LICENSE.md) の Vite core license。

```text
MIT License

Copyright (c) 2019-present, VoidZero Inc. and Vite contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
