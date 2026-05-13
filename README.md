# BPM Library Web Seed

AndroidアプリのB面「保存管理」をWebに見せるための静的サイト最小構成です。

## 目的

Web版では測定機能を持たせず、アプリで保存したBPMライブラリを公開・共有するための表示に集中します。

## ファイル構成

```text
index.html
style.css
app.js
songs.json
```

## Cloudflare Pages 設定

```text
Framework preset: None
Build command: 空欄
Build output directory: /
```

## 更新方法

1. Androidアプリから保存データをJSONエクスポート
2. `songs.json` を差し替える
3. GitHubへcommit
4. Cloudflare Pagesが自動反映

## songs.json の想定形式

```json
{
  "records": [
    {
      "title": "曲名",
      "artist": "アーティスト",
      "bpm": 128,
      "savedAt": "2026-05-13T12:00:00+09:00",
      "sourceApp": "Spotify",
      "album": "アルバム名",
      "note": "メモ",
      "spotifyUri": "spotify:track:...",
      "sourceMetadata": {
        "contextTitle": "プレイリスト名",
        "contextUri": "spotify:playlist:..."
      }
    }
  ]
}
```

## 広告枠

`index.html` の `.ad-slot` が広告・支援リンク用の最小スペースです。
サイト体験を壊さないよう、フッター付近に1枠だけ置く想定です。
