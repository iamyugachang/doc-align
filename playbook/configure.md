# doc-align configure — 初次接入設定程序

你是執行 doc-align configure 的 agent。目標：把 doc-align 接進目前 repo 的 CI
（GitHub Actions／GitLab CI，擇一或兩者），並輸出使用者必須手動完成的平台設定
清單。configure 只安裝 CI 接線，不做文件初始化（那是 init）、不執行 git commit。
`<DOC_ALIGN_ROOT>` 與 `<SCRIPTS>` 由呼叫端提供。`doc-align init --ci` 會在初始化完成後
自動進入本程序；單獨呼叫 `doc-align configure` 是事後補接 CI 的進階用法。

## 步驟

1. **前置檢查**：`docs/.docalign.yml` 必須存在（`node <SCRIPTS>/manifest.js read`
   成功）；否則停止並指引使用者先執行 `doc-align init`——CI 閘門在沒有 manifest
   的 repo 上會對每個 PR 報錯。
2. **偵測平台**：讀 `git remote -v`。remote host 含 `github.com` → GitHub 側適用；
   含其他 git host（內部 GitLab 域名）→ GitLab 側適用；同一 repo 兩種 remote 都有
   → 兩側都裝（雙平台 repo 各自的 CI 檔互不干擾：GitHub 只讀
   `.github/workflows/`，GitLab 只讀 `.gitlab-ci.yml`）。偵測不到任何 remote 時，
   詢問使用者目標平台。
3. **GitHub 側安裝**（適用時）：詢問使用者 LLM runner 用 direct（不依賴 agent、
   script 直接打 OpenAI-compatible endpoint）、opencode 還是 claude（非互動情境
   預設 direct），把 `<DOC_ALIGN_ROOT>/ci/doc-align-direct.yml`（或
   `doc-align-opencode.yml`／`doc-align-claude.yml`）複製到
   `.github/workflows/doc-align.yml`。目標檔已
   存在時不覆寫，改為輸出 diff 請使用者裁決。
4. **GitLab 側安裝**（適用時）：把 `<DOC_ALIGN_ROOT>/ci/doc-align-gitlab.yml`
   複製到 `.gitlab/doc-align.yml`。接著處理 `.gitlab-ci.yml`：
   - 不存在 → 建立，內容只有 `include:` 區塊引用 `.gitlab/doc-align.yml`。
   - 已存在 → 已含該 include 則不動；否則**不要自動改寫**（既有 pipeline 結構
     可能複雜），輸出應加入的 `include` 區塊請使用者自行貼入。
5. **輸出設定清單**：依安裝的平台列出使用者必須在平台 UI 完成的設定，逐項附
   用途說明：
   - GitHub（Settings → Secrets and variables → Actions）：Secret
     `DOC_ALIGN_LLM_API_KEY`（中立命名，填你選的 provider 的 key；claude 範本
     固定 Anthropic，opencode 範本另以 Variables `DOC_ALIGN_LLM_PROVIDER`／
     `DOC_ALIGN_LLM_MODEL`／`DOC_ALIGN_LLM_BASE_URL` 自由選家；direct 範本可選
     Variable `DOC_ALIGN_LLM_CUSTOM_CMD` 改跑自己的 harness）；doc-align repo
     為 private 時另需 `DOC_ALIGN_TOKEN`（read 權限 PAT，並依範本內註解調整
     clone URL）。
   - GitLab（Settings → CI/CD → Variables，勾 Masked）：`DOC_ALIGN_LLM_API_KEY`
     ＋`DOC_ALIGN_LLM_BASE_URL`＋`DOC_ALIGN_LLM_MODEL`（direct runner，預設）；
     要改用 opencode agent 另設 `DOC_ALIGN_LLM_RUNNER=opencode`（可再以
     `DOC_ALIGN_LLM_PROVIDER` 選公開 provider）；要接自己的 harness 設
     `DOC_ALIGN_LLM_RUNNER=custom`＋`DOC_ALIGN_LLM_CUSTOM_CMD`（契約見範本
     檔頭與 README「自帶 harness」）、
     `DOC_ALIGN_GITLAB_TOKEN`（api scope 的 project access token，發 MR note
     用）、內網連不到 GitHub 時 `DOC_ALIGN_REPO_URL` 指向 doc-align 的內部鏡像
     （並提醒需先建立該鏡像並保持同步）。
6. **驗證指引**：提醒使用者 commit 這些 CI 檔後，各平台開一個碰到 watch 範圍的
   測試 PR／MR 確認留言流程；未觸及 watch 的 PR 應零成本跳過。
7. **總結**：列出寫入／建議的檔案、偵測到的平台、尚待使用者完成的設定項。

## 注意

- 同一 repo 推兩個平台時，兩份 CI 檔一起進版控即可——彼此的 CI 系統會忽略
  對方的設定檔。
- GitLab 範本的 LLM 走 opencode 的 custom provider（`@ai-sdk/openai-compatible`），
  任何 OpenAI-compatible gateway 皆可；model id 照 gateway 的清單填。
