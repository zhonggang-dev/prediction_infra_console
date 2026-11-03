# 双控制台端口与发布

目标映射在 `../console_ports.py`：新应用 `prediction-console-v2 → 13000`，旧应用 `prediction-console → 13001`。只改监听端口，unit、container、image tag、配置目录、BFF 凭据仍分别独立。旧镜像不重建，旧 Docker 默认内部端口由 systemd 显式 `--port` 覆盖。

`remote_swap.py` 是运行于服务器 root 的适配器，持有两个前端 `.deploy.lock` 至真实 UI 验收或整对回滚完成。首次切换停两套前端后再改配置；已经是目标映射时，它只更新新应用、不重启受保护旧应用。此脚本从不重启 Trading 或 Infra。

## 来源和前置检查

必须先 PR 合并 main，从精确 merge SHA 导出、构建候选镜像。镜像标签要求：

- `org.opencontainers.image.revision` = 完整 merge SHA。
- `org.opencontainers.image.source-branch` = `main`。
- `org.opencontainers.image.source-archive-sha256` = 本次导出源码的 SHA256。

将本次主干源码中的 `deploy/console-port-swap/`、`deploy/console_ports.py`、两个 `deploy/*.service` 按原目录关系放到受限远端操作目录；不要只复制单个 runner。unit、runner 必须来自同一已审查 main 归档。

先在临时未占用端口启动候选镜像，使用真实后端只读配置验收桌面、390px、五账户四 Tab、精确 Lot 分页、历史归属、下载和旧接口。验收后关闭预览实例，在候选 release 目录写 `PREVIEW_VERIFIED`，内容为完整 merge SHA。此标记不是线上 `UI_VERIFIED`；候选 release 不得预置 UI 成功或失败标记。

## 只读采集 metadata

例中参数均为本轮实测值，不使用文档旧 SHA。`capture_metadata.py` 读取两容器 ID/image/start/restarts、实际命令端口、current 指针、unit 和 service.env 哈希以及 Trading PID/运行二进制 SHA256，不读取或输出 env 值。

```bash
sudo python3 deploy/console-port-swap/capture_metadata.py \
  --operation-id '<本轮唯一操作名>' \
  --host 172.21.20.221 \
  --release '/opt/prediction-console-v2/releases/<本轮release>' \
  --merge-sha '<main完整SHA>' \
  --source-archive-sha256 '<源码归档SHA256>' \
  --image-sha256 'sha256:<候选镜像ID>' \
  --output '/root/<本轮metadata>.json'
sudo python3 deploy/console-port-swap/remote_swap.py \
  --metadata-json '/root/<本轮metadata>.json' --preflight
```

metadata 的 `baseline` 按两个固定服务名索引，每项包含 `container`（id/image/started_at/restart_count/status/running）、`port`、`pointer_target`、`unit_sha256`、可空 `service_env_sha256`、`unit_template_sha256`。不存在的 service.env 用 null；元数据不接受 token/secret/credential 等敏感键。观察到非预期 unit 路径或 drop-in、非完整角色映射、容器/后端/指针/配置变化一律拒绝。

`startup_timeout_seconds` 可选 1–300，默认90；`ui_timeout_seconds` 可选1–1800，默认900。双锁、模板、端口、镜像来源和 CAS 不允许从参数绕过。

## 切换与真实验收

先告知双前端短暂维护窗口，再执行：

```bash
sudo python3 deploy/console-port-swap/remote_swap.py \
  --metadata-json '/root/<本轮metadata>.json' --deploy
```

操作器将原 unit/service.env 保存在 `/opt/prediction-console-v2/port-swaps/<operation-id>/`，目录0700、文件0600；保留环境原内容，仅替换对应 PORT 键。正常切换后，日志进入 `console_pair_waiting_ui`，锁仍持有。此时主会话必须在**实际13000和13001**验收新旧页面、深链接、只读BFF、账户、Lot/分页、下载及安全头，然后：

```bash
# 真实验收成功后，将完整候选 main SHA 写到候选 release/UI_VERIFIED。
# 失败则写候选 release/UI_REJECTED，不把失败伪装为成功。
```

成功输出 `console_pair_verified`。失效标记、超时、HTTP/启动失败或中断信号都会尝试整对恢复原 unit、service.env、镜像 tag 与 current，然后验证原端口。**回滚也先停两套已改进程再恢复端口**，避免13000/13001互抢。发现未知第三方容器/镜像/指针/配置或后端变更时拒绝自动回滚，保留受限备份与错误阶段交主会话处理，绝不杀未知进程。SIGKILL/主机故障无法自动处理，恢复时必须先核对实际归属再参考备份，不能盲目覆盖。

后续旧应用发布仍使用 `../legacy-release/`，其固定端口已同步13001且保护新应用13000；新应用后续发布可继续使用本runner，目标映射已成立时只动新应用。

## 离线检查

```bash
python3 -m unittest discover -s deploy/console-port-swap -p 'test_*.py'
python3 -m unittest discover -s deploy/legacy-release -p 'test_*.py'
```
