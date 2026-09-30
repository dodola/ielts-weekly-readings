# IELTS Reading Workflow

本仓库保存周更流程代码。筛选后的本地原文及精读产物发布到用户明确指定的 **private** 仓库，公开代码库不保存文章产物。

工作流复用 IELTS Reading Curator 的 EPUB 提取、TypeSafe Jev 判断、确定性筛选和缓存，再调用本机 Codex 与已安装的 `intensive-reading` IELTS 分支自动生成讲解、Word、PDF。私有库首页直接列出文章标题、期号、出版方原文链接、筛选分数/主题/难度，以及原文和精读文件下载。

## 命令

Node.js ≥22；原 curator 已安装依赖并配置 TypeSafe；Codex 已登录；本机已安装 `intensive-reading`。导出需要 pandoc、LibreOffice/soffice、python3 及 skill 原有 Python 依赖、Poppler（pdftotext/pdfinfo/pdftoppm）和中文字体。Git/gh 使用用户既有授权登录。

```bash
# 更新确切来源目录并预览；不调用 AI、不发布
node scripts/weekly.mjs --project /path/to/ielts-reading-curator \
  --source /path/to/awesome-english-ebooks

# 周更：过去7个北京时间日历日，全部候选，最多10篇精读
node scripts/weekly.mjs --project /path/to/ielts-reading-curator \
  --source /path/to/awesome-english-ebooks \
  --output-repo /path/to/private-reading-library \
  --repository dodola/ielts-reading-library --execute --publish --max-guides 10 --mode full-ielts --generation-concurrency 2

# 月度试跑/补录：明确日期范围（最多31天）
node scripts/weekly.mjs --project /path/to/ielts-reading-curator \
  --source /path/to/awesome-english-ebooks \
  --output-repo /path/to/private-reading-library \
  --repository dodola/ielts-reading-library \
  --from 2026-09-01 --to 2026-09-30 --execute --publish --max-guides 10 --mode full-ielts --generation-concurrency 2

npm test
node scripts/weekly.mjs --help
```

目标仓库必须事先创建为 private 并有自己的 checkout。运行前、写入原文前、每次发布前和 push 前均通过 GitHub API 检查目标仓库的准确身份及 `private=true`。目标为 public、未知状态、身份不匹配、remote 不匹配时停止；不会将原文推回公开代码库，不添加协作者，不改变已有仓库的可见性。

## 来源、筛选与用量

每次在线运行首先检查用户指定外刊目录的 origin、branch、upstream 及全部本地修改，再执行 `git pull --ff-only --no-rebase`。来源沿用既有 `hehonghui/awesome-english-ebooks` checkout；分支应同名跟踪 origin。有修改、分叉、冲突或更新失败时保留现场并停止，不 reset、不覆盖修改、不静默使用旧数据。`--offline` 仅允许诊断预览，不能分析或发布。

日期按 `Asia/Shanghai` 计算，默认包含执行日及此前6天；显式 `--from/--to` 处理完整日期范围，跨月会扫描所涉及月份。支持 Economist、New Yorker、Atlantic、Wired，期号日期是选择依据，不能推定单篇文章实际发表日。全部候选按原项目规则分析，`selected` 按综合分数排序，从具有可靠出版方文章链接且讲义审核通过的文章中取最多 **10篇**；不足时按实际数量。`review` 不自动变成推荐。`--max-articles` 可显式限制候选，默认不限。

用户明确要求不限制 TypeSafe 额度：不设货币或总逻辑请求上限；保留既有 SDK 每请求最多2次重试、请求超时、有效缓存去重。长文按完整分段分析，预览报告的逻辑请求数不含传输重试。不会充值、新增订阅或更改计费设置。截止2026-09-30，官方公布 Jev 输入价为 $0.042/百万token、输出免费（[官方说明](https://typesafe.ai/blog/introducing-system-one-models-and-jev)）；公开价不能确认用户余额、预付积分或自动扣费状态。

## 完整 IELTS 精读与私有归档

默认且唯一生成模式是 `full-ielts`，版本 `private-full-ielts-v1`。Codex 直接按本机 `intensive-reading` 的完整 IELTS 模板分块写 `guide.md`，不使用稀疏 JSON 节选模板。原文全部保留，按句给出完整中文翻译；每个功能块含双语对照、表达清单、详尽词汇注释和篇章精读。词条包含原文回填、搭配、必要辨析、外刊写作赏析和 IELTS 四档迁移判断；按证据提供替代用法、逻辑箭头图、竞争性解释和写作迁移。遵循 IELTS 分支，不套用高考专属语法填空/考点扫描模块。

原输入每段赋予隐藏 `source:P001` 等标记。发布前逐段检查全部英文句子的连接序列与原输入完整一致（包括数值），段落数量/顺序无遗漏，英中句对齐，并检查每块四层结构与词条模块。校验结果、双语句对数量、原文段覆盖数量、PDF 页数写入元数据。旧节选缓存因模式/版本哈希不同而失效，不能作为完整精读复用；TypeSafe 筛选缓存保持有效。

原文另存 `original.txt`，来自用户明确指定的本地输入，保留标题、出版方、作者、期号和文章链接；不从额外付费墙获取全文。仅归档最终生成精读的最多10篇，不上传整期期刊 PDF/EPUB 或全部候选。

受信任进程执行安装 skill 的固定 `scripts/build.sh`，保留字形、六角色和字面星号门禁，导出真实 DOCX/PDF。独立审核读取完整讲义与原输入，审查全文覆盖、翻译含义、词汇/语域/论证教学，并抽查实际渲染的封面、词条/表格、内页和末页。记录生成及审核日志回执中的 model/effort，不公开 session ID、提示词或日志。未通过完整校验或审核的产物不发布。

私有可见性不等于出版方转载授权。本流程只整理用户给定的本地输入及转换产物；未经授权内容不得复制到 public 仓库或添加协作者传播。源链接从 EPUB canonical、og:url 或明确来源导航提取并校验 HTTPS/出版方域名，无法明确对应的文章会记录并跳过，不猜URL；必要时用私有 `--source-links` JSON 补入经过验证的 `issueId/articleId -> URL` 映射。

不合格草稿最多自动修复一次，独立审核失败时留在私有任务目录并记录，停止本轮发布；修复后可用同一命令续办。每个日期范围最多40次 Codex 生成/审核预留，失败也计数；完整精读生成子任务45分钟、审核子任务25分钟、整轮4小时超时停止。内容、分析、规则及 skill 哈希参与指纹；通过审核的原文/讲义文件另有完整性哈希，重复执行复用缓存与审核结果。新增运行的源更新、生成、构建、审核和发布日志另存阶段起止/时长JSON，供核对耗时。默认最多2篇独立文章生成/审核并行，每个内容任务只分配一次；Word/PDF构建、成品写入及git提交/push分别串行。任何工作槽失败后不启动新文章，但让其他进行中任务完成并保留成果。每篇通过后立即提交发布，后续中断不丢已完成产物。同一命令重跑可以续办，月度与周度共享筛选缓存。

只白名单提交 `original.txt`、`guide.md`、`guide.docx`、`guide.pdf`、精简 `metadata.json` 及 README/INDEX，不使用 `git add .`，不上传本机路径、凭证、原项目无关文件或私有缓存日志。原 curator 项目的未提交工作不受影响。

```text
private-checkout/readings/<issue-id>/<article-id>/
  original.txt
  guide.md
  guide.docx
  guide.pdf
  metadata.json
private-checkout/README.md   # 成品目录、原文与下载链接
private-checkout/INDEX.md
code-checkout/.private/      # Git 忽略，始终留在本机
  cache/                    # 原文提取、全部筛选结果
  jobs/<content-hash>/       # 生成、构建、审核、中间文件
  runs/<from>_<to>/          # 运行报告、刷新日志、生成次数
```

不安装 cron 或重复 GitHub Actions。由用户电脑上的官方自动任务每周六按北京时间调用正式命令，机器、网络和已有登录需要可用。受限环境需要允许指定来源目录快进写入、子进程和网络访问；权限不足时报告，不跳过刷新或可见性检查。
