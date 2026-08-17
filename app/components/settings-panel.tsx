import { Status } from "./status";

/** 设置页只说明服务端连接边界，不读取或暴露任何令牌值。 */
export function SettingsPanel() { return <section className="panel panel-pad"><div className="settings-list"><Setting title="API 访问方式" description="浏览器仅请求同源 /api/console/*，不会接触 Go 服务令牌。"><Status value="active" /></Setting><Setting title="控制台后端" description="PREDICTION_INFRA_BASE_URL 与 CONSOLE_API_TOKEN 在前端服务环境中配置。"><span className="mono muted">服务器侧</span></Setting><Setting title="回测数据集" description="使用独立 BACKTEST_DATASET_TOKEN，避免扩大控制台令牌权限。"><span className="mono muted">服务器侧</span></Setting><Setting title="时间标准" description="请求、响应和页面显示均使用 UTC（ISO 8601）。"><span className="mono muted">UTC</span></Setting></div></section>; }
function Setting({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <div className="setting"><div><div className="setting-title">{title}</div><div className="setting-desc">{description}</div></div>{children}</div>; }
