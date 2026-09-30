# IELTS Weekly Readings

每周外刊公开节选精读。复用现有 IELTS Reading Curator 的来源扫描、EPUB 提取、TypeSafe Jev 判断、缓存与确定性筛选规则，再调用本机 Codex 和已安装的 `intensive-reading` skill 生成原创中文教学讲义。

本仓库只发布原创总结、语言讲解、论证分析、必要短引文及出版方文章链接。来源仓库可供本机输入，**不构成转载授权**；外刊 PDF、EPUB、图片、文章全文和实质替代全文的翻译不进入本仓库。讲义明确标注为 skill 的“公开节选版”，不同于原 skill 的完整逐段双语讲义。

## 运行

要求在已配置的用户电脑上执行，Node.js ≥22；原 curator 项目已安装 npm 依赖和 TypeSafe 配置，Codex 已登录，`intensive-reading` skill 已安装。导出依赖 pandoc、LibreOffice/soffice、python3（python-docx 等 skill 已有依赖）、Poppler 的 pdftotext/pdfinfo/pdftoppm 及中文字体。发布需要 Git、已授权的 gh/GitHub 认证。

```bash
# 默认：更新指定来源并预览，不调用 AI、不提交或发布
node scripts/weekly.mjs --project /path/to/ielts-reading-curator \
  --source /path/to/awesome-english-ebooks

# 每周正式执行：过去 7 个北京时间日历日，最多 10 篇精读
node scripts/weekly.mjs --project /path/to/ielts-reading-curator \
  --source /path/to/awesome-english-ebooks --execute --publish --max-guides 10

# 月度试跑或补录：明确日期范围，最多 31 个日历日
node scripts/weekly.mjs --project /path/to/ielts-reading-curator \
  --source /path/to/awesome-english-ebooks \
  --from 2026-09-01 --to 2026-09-30 --execute --publish --max-guides 10

npm test
node scripts/weekly.mjs --help
```

脚本必须先检查来源目录 origin、当前分支、upstream 和所有本地修改，再执行 `git pull --ff-only --no-rebase`。来源必须是用户既有的 `hehonghui/awesome-english-ebooks` checkout，当前分支应同名跟踪 origin。发现未提交修改、分叉、冲突、刷新失败时保留现场并停止，不 reset、不覆盖修改、不默默使用旧数据发布。刷新包含上游原有期刊文件，仅保留在用户指定的本地来源。

`--offline` 只用于无网络诊断，禁止与 `--execute` 或 `--publish` 同用。默认在线预览也会首先更新来源。运行日期与筛选窗口按 `Asia/Shanghai` 计算；默认包含执行当天及此前 6 天。期号日期是选材依据，单篇文章实际发表日期可能更早。支持 Economist、New Yorker、Atlantic、Wired。月度与跨月周度范围均会扫描涉及的月份。

## 全链路

1. 安全刷新指定外刊目录，扫描日期窗口内全部支持期号。
2. 通过原项目 `bin/ielts-curator.mjs articles/analyze --dry-run` 提取候选并预览预计请求数；缓存写在本仓库忽略的 `.private/cache/`，不修改原项目数据。
3. 按原项目规则分析全部候选，保留逐篇缓存；按综合分数排序，只处理 `selected`。默认最多 **10 篇讲义**，这是产出上限，推荐不足时按实际数量生成。`review` 不自动转成推荐，不以凑数替换标准。可显式用 `--max-articles` 限定候选范围，默认不限。
4. 为每篇建立私有工作目录，Codex 读取原文及 skill 的 IELTS 方法、模板、语域判据，自动输出受 JSON schema 约束的讲义内容。无需手动填写讲义模板。受信任代码统一渲染 Markdown。
5. 公开内容最多一个不超过 20 词的短引文；该引文和列出的源文表达合计不超过 25 词。只翻译短引文，不逐段转述全文。其他例句和搭配为原创；每个词条含作者表达选择、IELTS 迁移分级、替代表达。原文中的未声明长片段会被检测并拒绝。
6. 出版方 URL 从 EPUB canonical、og:url、来源导航标记等明确来源提取，验证 HTTPS 与刊物域名，不猜链接。个别 EPUB 缺少原链接时，会停止并说明具体文章；可补入经过验证的私有 `--source-links` JSON，键为 `issueId/articleId`。该文件不公开。
7. 使用安装 skill 的固定 `scripts/build.sh` 导出 DOCX 和 PDF，保留字形、六角色、字面星号门禁。实际渲染封面、内页与末页供独立 Codex 审核；同时检查内容质量、有限引文、是否构成全文替代、隐私和来源。审核失败的文件留在私有目录，不发布。
8. 仅将通过审核的 `guide.md`、`guide.docx`、`guide.pdf`、精简 `metadata.json` 和汇总 `INDEX.md` 加入 Git，提交并 push 到指定 public 仓库。禁止 `git add .`，不上传缓存、源文、提示词、日志、密钥或原项目文件。

默认保留合理的 TypeSafe SDK 重试（每请求最多 2 次）、请求超时、有效缓存去重与进程锁。用户明确要求不限制 TypeSafe 额度，因此脚本不设置货币预算或总请求配额。完整长文可能分为多个请求；预览报告的逻辑请求数量不包括最多两次传输重试。外部 API 的实际扣费取决于账户计费设置；不会自动充值、新增订阅或更改计费设置。

截至 2026-09-30，TypeSafe 官方公布 Jev 输入价格为 **$0.042 / 百万 token**，输出免费（[官方说明](https://typesafe.ai/blog/introducing-system-one-models-and-jev)）。这是公开价参考，不能据此断定账户余额、预付积分或自动扣费状态；脚本也不承诺金额上限。Codex 使用本机现有登录，消耗相应账户用量。

每个日期范围最多预留 40 次 Codex 生成/审核调用，失败也计数；单次子任务 25 分钟、整轮 4 小时超时停止。原文、规则、分析和安装 skill 内容参与产物指纹；同内容重复运行复用缓存及已通过审核的产物，不重复生成或发布。中断后原命令重跑可续办。任何分析失败会保留已完成筛选并停止；不会把部分失败说成完整筛选。

## 文件

```text
readings/<issue-id>/<article-id>/
  guide.md
  guide.docx
  guide.pdf
  metadata.json
INDEX.md
.private/                  # 全部 Git 忽略，仅在本机
  cache/                   # 原文及筛选缓存
  jobs/<content-hash>/      # 自动生成、构建、审核、中间文件
  runs/<from>_<to>/         # 刷新日志、私有运行报告、生成次数预留
```

本仓库不设置 cron 或 GitHub Actions 调度。由用户电脑上的官方自动任务每周六按北京时间调用正式命令；执行时机器、网络和已有登录必须可用。受限沙箱需要允许对指定来源目录的快进更新、子进程及网络访问，不能因权限不足跳过刷新。
