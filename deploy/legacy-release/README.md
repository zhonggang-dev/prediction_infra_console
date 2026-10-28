# 旧版控制台（13000）发布脚本

13000 的源码在 [`legacy-console/`](../../legacy-console/)（见仓库 README「旧版 13000」）。这里是把它的镜像安全切到线上的脚本：持锁、校验身份、切换、验证页面、失败回滚。13001（`prediction-console-v2`）只作为"受保护对象"被检查，脚本不会动它。

| 文件 | 作用 |
| --- | --- |
| `remote_frontend.py` | 真正动手的发布器，只在服务器上以 root 运行：校验元数据 → 持部署锁 → 打 `prediction-console:current` 标签、切 `current` 指针 → 重启 `prediction-console.service` → 等容器和页面就绪 → 等 `UI_VERIFIED` 握手；任何一步失败都按身份比对（CAS）回滚到旧镜像 |
| `deploy_frontend.py` | 离线守卫（不碰 Docker / systemd），校验元数据、镜像标签、握手、回滚归属 |
| `test_remote_frontend.py`、`test_release_guards.py` | 上面两个的单元测试（假 IO，不连服务器） |

来源：2026-10-26 官方盈亏卡片上线时写在任务 `10-26-official-wallet-pnl-chart/ops/`（父仓库归档），2026-10-27 适配 `legacy-console/` 后挪到这里，以后改这里。

## 和 10-26 版的区别

13000 不再用 `legacy/manifest.json` 拼装，所以：

- 元数据去掉 `legacy_source_commit`，镜像也不再带 `com.unipai.legacy-source-commit` 标签，`DEPLOYMENT.json` 里不再写它。
- `wallet_pnl_expected` 改为**可选**。只有改到官方盈亏卡片的发布才需要给（给了就照旧探测钱包 6 / 7 的接口并检查「官方盈亏」「运行监控」两个 Tab）。
- 新增可选的 `smoke_pages`（路径列表，默认 `["/live", "/backtest-platform", "/dataset-rotation"]`，最多 10 个）：切换后这些页面必须都返回 200，否则回滚。

## 发布步骤

只从**已合并 main** 的精确提交发布。

1. 本机：`git archive` 打出该提交的源码包，算 sha256（macOS 用 `COPYFILE_DISABLE=1`）。

   ```bash
   COPYFILE_DISABLE=1 git archive --format=tar.gz -o console-<sha7>.tar.gz <40位提交>
   shasum -a 256 console-<sha7>.tar.gz     # → source_archive_sha256
   scp console-<sha7>.tar.gz zhangyan:/home/zhangyan/
   ```

2. 服务器：解到构建目录 `/opt/prediction-console/releases/<sha7>-<说明>-build/`，**在 `legacy-console/` 上下文**构建镜像，并带上三个标签。注意不要解到元数据 `release` 指向的那个目录：发布器要求它事先不存在（由发布器创建并写 `DEPLOYMENT.json`，`current` 指针指向它），已存在会在切换前报 `release directory already exists`。

   ```bash
   cd /opt/prediction-console/releases/<sha7>-<说明>-build
   sudo docker build -f legacy-console/Dockerfile \
     --build-arg RELEASE_MERGE_SHA=<40位提交> \
     --build-arg BACKEND_BINARY_SHA256=<后端二进制 sha256> \
     --label com.unipai.source-archive-sha256=<source_archive_sha256> \
     -t prediction-console:<tag> legacy-console
   ```

   元数据里的 `image_sha256` 是这个镜像的完整 ID（`sha256:…`），不是标签名。
3. 准备元数据 JSON（不含任何令牌 / 密码，含这类键名会被拒绝）。必填：`release`（`/opt/prediction-console/releases/…` 下的单层目录）、`merge_sha`、`source_branch`（只能是 `main`）、`source_archive_sha256`、`image_sha256`、`backend_identity`（一个这次发布期间不应变化的后端进程：`pid`、`binary_path`、`binary_sha256`；10-26 用的是 trading-execution）、`legacy_identity`（现在 `prediction-console` 容器的 id / image / started_at / restart_count / status / running 与 `current` 指针）、`protected_v2_identity`（`prediction-console-v2` 容器同样的字段）、`legacy_http_base_url`。**13000 监听内网地址**，例如 `http://172.21.20.221:13000`，不是 `127.0.0.1`。可选：`wallet_pnl_expected`、`smoke_pages`、`ui_timeout_seconds`（默认 900）、`ui_poll_seconds`、`startup_timeout_seconds`。
4. 把脚本和元数据放到服务器，**在服务器上以 root 运行**（脚本只有这一种运行方式，不会转发、不会在本机执行）：

   ```bash
   scp deploy/legacy-release/remote_frontend.py meta.json zhangyan:/home/zhangyan/legacy-release/
   ssh zhangyan 'sudo -n python3 /home/zhangyan/legacy-release/remote_frontend.py --metadata-json /home/zhangyan/legacy-release/meta.json --preflight'
   ```

   `--preflight` 是只读检查：现有 13000 / 13001 容器身份、`current` 指针、后端进程、候选镜像的 ID 与标签。
5. 确认没有人在用线上，再发布：同一条命令把 `--preflight` 换成 `--deploy`。发布器会等到 `<release>/UI_VERIFIED`，文件内容必须是 `merge_sha`；写 `UI_REJECTED` 则立即回滚。超时也回滚。
6. 本地跑测试：

   ```bash
   python3 -m unittest discover -s deploy/legacy-release -p "test_*.py"
   ```

## 回滚

发布器失败时自动回滚到元数据里记录的旧镜像和旧指针。手动回滚：把旧镜像 tag 回 `prediction-console:current`，`current` 指针指回旧 release 目录，重启 `prediction-console.service`。

## 备注

2026-10-27 逐时点策略（pm_sim）的前端发布是手工完成的（构建镜像 → 隔离只读容器验证 → 换标签重启 → 页面探测），没有走这个发布器；这个适配就是为了下一次发布能走它。
