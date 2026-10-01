# IELTS Reading Workflow

本仓库保存周更流程代码。筛选后的本地原文及精读产物发布到用户明确指定的 **private** 仓库，公开代码库不保存文章产物。

工作流复用 IELTS Reading Curator 的 EPUB 提取、TypeSafe Jev 判断、确定性筛选和缓存，再调用本机 `agy` 与已安装的 `intensive-reading` IELTS 分支自动生成讲解、Word、PDF。私有库首页直接列出文章标题、期号、出版方原文链接、筛选分数/主题/难度，以及原文和精读文件下载。

默认采用 `balanced-publications-v1`：先在有合格候选和可信来源链接的刊物中各取最佳文章，再在当前分配篇数最少的刊物中按质量选择下一篇。四刊均有足够合格文章时，10篇通常分为3/3/2/2；没有合格文章或可信链接的刊物明确标缺，不硬凑、不用过期文章补数。刊内按综合分、置信度、相同质量下较短篇幅、期号和稳定ID排序，消除输入顺序对同分结果的影响。每轮10篇总上限不变，历史成品累计保留；首页/索引列出各刊累计数量。

出版方链接优先使用EPUB的canonical/og:url、原链接导航与Calibre `rel="calibre-downloaded-from"` 下载来源标记；不会把正文中引用的其他文章误作当前原文。New Yorker没有内嵌来源时，读取官方当期目录，要求标题、同一文章卡片的作者、期号及唯一官方URL均匹配；只缓存核实过的链接元数据，不获取额外付费全文。缺失、冲突或无法唯一匹配时报告并跳过。

`--publications new-yorker,atlantic,wired --max-guides 3 --cached-only --from 2026-09-01 --to 2026-09-30` 可从9月旧筛选缓存中为这三刊各补1篇；仍需常规project/source/output/repository及execute/publish参数。此类子集运行有独立的日期/刊物报告和生成计数，与原月度报告共存，共享分析和成品缓存。`--cached-only` 在缺少分析时直接停止，不产生新的TypeSafe请求。日期范围按原项目的期号/来源包日期选择，不等同于每篇网页首发日期。

2026年9月诊断：Economist 295候选/256合格、New Yorker 79/52、Atlantic 14/12、Wired 56/43；四刊均参与原444篇分析。旧全局排名加10篇截断没有刊物保底，且旧链接解析漏掉Calibre下载来源，New Yorker也无内嵌链接。修复后可信链接合格候选为256/47/12/43；New Yorker剩余5篇无法唯一匹配，明确跳过。只读全月缓存按新规则选10篇时为Economist 3、New Yorker 2、Atlantic 2、Wired 3。

## 命令

Node.js ≥22；原 curator 已安装依赖并配置 TypeSafe；`agy` 已有有效登录且 `agy models` 包含 `gemini-3.8-flash-high`；本机已安装 `intensive-reading`。导出需要 pandoc、LibreOffice/soffice、python3 及 skill 原有 Python 依赖、Poppler（pdftotext/pdfinfo/pdftoppm）和中文字体。Git/gh 使用用户既有授权登录。

```bash
# 更新确切来源目录并预览；不调用 AI、不发布
node scripts/weekly.mjs --project /path/to/ielts-reading-curator \
  --source /path/to/awesome-english-ebooks

# 周更：过去7个北京时间日历日，全部候选，最多10篇精读
node scripts/weekly.mjs --project /path/to/ielts-reading-curator \
  --source /path/to/awesome-english-ebooks \
  --output-repo /path/to/private-reading-library \
  --repository dodola/ielts-reading-library --execute --publish --max-guides 10 --mode full-ielts --generator agy --generation-concurrency 2

# 月度试跑/补录：明确日期范围（最多31天）
node scripts/weekly.mjs --project /path/to/ielts-reading-curator \
  --source /path/to/awesome-english-ebooks \
  --output-repo /path/to/private-reading-library \
  --repository dodola/ielts-reading-library \
  --from 2026-09-01 --to 2026-09-30 --execute --publish --max-guides 10 --mode full-ielts --generator agy --generation-concurrency 2

npm test
node scripts/weekly.mjs --help
```

目标仓库必须事先创建为 private 并有自己的 checkout。运行前、写入原文前、每次发布前和 push 前均通过 GitHub API 检查目标仓库的准确身份及 `private=true`。目标为 public、未知状态、身份不匹配、remote 不匹配时停止；不会将原文推回公开代码库，不添加协作者，不改变已有仓库的可见性。

## 来源、筛选与用量

每次在线运行首先检查用户指定外刊目录的 origin、branch、upstream 及全部本地修改，再执行 `git pull --ff-only --no-rebase`。来源沿用既有 `hehonghui/awesome-english-ebooks` checkout；分支应同名跟踪 origin。有修改、分叉、冲突或更新失败时保留现场并停止，不 reset、不覆盖修改、不静默使用旧数据。`--offline` 仅允许诊断预览，不能分析或发布。

日期按 `Asia/Shanghai` 计算，默认包含执行日及此前6天；显式 `--from/--to` 处理完整日期范围，跨月会扫描所涉及月份。支持 Economist、New Yorker、Atlantic、Wired，期号日期是选择依据，不能推定单篇文章实际发表日。全部候选按原项目规则分析，从具有可靠出版方链接的 `selected` 中按上述刊物覆盖规则取最多 **10篇**；不足时按实际数量。`review` 不自动变成推荐。`--max-articles` 可显式限制候选，默认不限。

用户明确要求不限制 TypeSafe 额度：不设货币或总逻辑请求上限；保留既有 SDK 每请求最多2次重试、请求超时、有效缓存去重。长文按完整分段分析，预览报告的逻辑请求数不含传输重试。不会充值、新增订阅或更改计费设置。截止2026-09-30，官方公布 Jev 输入价为 $0.042/百万token、输出免费（[官方说明](https://typesafe.ai/blog/introducing-system-one-models-and-jev)）；公开价不能确认用户余额、预付积分或自动扣费状态。

## 完整 IELTS 精读与私有归档

默认且唯一生成模式是 `full-ielts`，版本 `private-full-ielts-v1`。按用户最新模型选择，生成与修复由本机 `agy` 显式指定 `gemini-3.8-flash-high` / `high`，不可用时停止，不退回其他模型。此前成品的 `gpt-6.1-sol/high` 元数据保持原样。生成器直接按本机 `intensive-reading` 的完整 IELTS 模板分块写 `guide.md`，不使用稀疏 JSON 节选模板。原文全部保留，按句给出完整中文翻译；每个功能块含双语对照、表达清单、详尽词汇注释和篇章精读。词条包含原文回填、搭配、必要辨析、外刊写作赏析和 IELTS 四档迁移判断；按证据提供替代用法、逻辑箭头图、竞争性解释和写作迁移。遵循 IELTS 分支，不套用高考专属语法填空/考点扫描模块。

原输入每段赋予隐藏 `source:P001` 等标记。发布前逐段检查全部英文句子的连接序列与原输入完整一致（包括数值），段落数量/顺序无遗漏，英中句对齐，并检查每块四层结构与词条模块。校验结果、双语句对数量、原文段覆盖数量、PDF 页数写入元数据。旧节选缓存因模式/版本哈希不同而失效，不能作为完整精读复用；TypeSafe 筛选缓存保持有效。

原文另存 `original.txt`，来自用户明确指定的本地输入，保留标题、出版方、作者、期号和文章链接；不从额外付费墙获取全文。仅归档最终生成精读的最多10篇，不上传整期期刊 PDF/EPUB 或全部候选。

受信任进程执行安装 skill 的固定 `scripts/build.sh`，保留字形、六角色和字面星号门禁，导出真实 DOCX/PDF。按用户2026-09-30的新指示，默认取消独立模型审核和为审核做的 PDF 图片抽查；保留原文完整性、结构和导出成功校验。新成品元数据明确写 `independentReview: disabled-by-user`，不会虚报审核通过；此前已审核的正式成品仍可复用。记录实际指定的 model/effort、CLI运行解析证据和用量；响应没有单独提供provider模型字段时明确注明，不能把指定值冒充provider回执。不公开session ID、提示词或日志。

数值导出校验另核对真实Word全部英文序列及Word/PDF句块计数，不做模型内容审核。New Yorker的原文结束标记`♦`在英文打印字体中不可见，经实际单页探针验证后，仅在私有导出副本中按skill原有映射机制换为可见的`◆`；其余构建脚本和门禁逐字保留，安装skill不改动，原文TXT/Markdown保留原始符号。Word完整性比较明确记录这项打印兼容映射，不删除或改写英文内容。

私有可见性不等于出版方转载授权。本流程只整理用户给定的本地输入及转换产物；未经授权内容不得复制到 public 仓库或添加协作者传播。源链接从 EPUB canonical、og:url 或明确来源导航提取并校验 HTTPS/出版方域名，无法明确对应的文章会记录并跳过，不猜URL；必要时用私有 `--source-links` JSON 补入经过验证的 `issueId/articleId -> URL` 映射。

全文结构校验不合格最多自动修复一次；仍不合格则停止并保留现场，可用同一命令续办。每个日期范围最多40次生成/修复预留（历史参数名 `--max-codex-calls` 保留兼容），失败也计数；完整精读生成子任务45分钟、整轮4小时超时停止。内容、分析、规则及 skill 哈希参与指纹；原文/讲义文件另有完整性哈希，重复执行复用有效缓存。源更新、生成、构建和发布日志另存阶段起止/时长JSON，供核对耗时。默认最多2篇独立文章生成并行，每个内容任务只分配一次；Word/PDF构建、成品写入及git提交/push分别串行。任何工作槽失败后不启动新文章，但让其他进行中任务完成并保留成果。每篇完成后立即提交发布，后续中断不丢已完成产物。同一命令重跑可以续办，月度与周度共享筛选缓存。

生成预装完整 skill 的方法、IELTS 模板/靶子、六条共享排版约束、字形映射以及全部本地原文。引用文件保持原样，不做摘要；同轮两个工作槽共用一个参考快照。写手继续先落骨架、按 skill 的约100–250行粒度分块落盘，完成后调用现成只读覆盖校验器，避免重复读取参考/已完成块、重复编写校验脚本。完整内容要求及构建门禁不变，既有正式成品无需重做。

只白名单提交 `original.txt`、`guide.md`、`guide.docx`、`guide.pdf`、精简 `metadata.json` 及 README/INDEX，不使用 `git add .`，不上传本机路径、凭证、原项目无关文件或私有缓存日志。原 curator 项目的未提交工作不受影响。

**切换验证状态（2026-10-01）：** `agy` 单次无文件测试已成功，CLI运行日志确认解析 `gemini-3.8-flash-high` 并使用 `daily-cloudcode-pa.googleapis.com` 的Google Code Assist接口。新生成提示和完整参考只存本机私有job文件，argv只包含读取该文件的短指令。完整文章调用被自动审批阻止，原因是需要明确允许将本地全文发送到该服务；没有绕过，也尚未取得Gemini完整成品或速度数据。以下周更命令已接入新后端，但首次完整端到端测试仍待此授权，不应标为验证完成。

此前Codex冷生成诊断入口为 `node scripts/benchmark-full.mjs --baseline-job .private/jobs/<job-id> --name <unique-name>`。它只复制原输入，在全新 `.private/benchmarks/<name>` 生成完整 MD/DOCX/PDF；不调用 TypeSafe、不读取旧讲义当缓存、不修改或发布正式产物。阶段计时、工具调用数量、CLI报告的token数、输出字节和覆盖结果保存在私有 `summary.json`。独立审核现在按用户要求跳过，应单独列出这项流程减少，不能冒充生成提速。不同时间/负载和随机输出的一篇历史对照不能当作严格受控速度保证，token总数也不能冒充输入/输出/推理分项。该诊断入口是此前Codex基线；模型切换期间不要用它新启动Codex任务。默认2篇并行保持不变。

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
