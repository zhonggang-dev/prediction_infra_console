import { legacyBacktestUrl } from "../../lib/legacy-platform";
import { BacktestWorkspace, type BacktestView } from "./workspace";

/** 服务端入口：读取运行时配置（旧平台外链）后交给客户端工作区。 */
export function BacktestPage({ view }: { view: BacktestView }) {
  return <BacktestWorkspace view={view} legacyUrl={legacyBacktestUrl()} />;
}
