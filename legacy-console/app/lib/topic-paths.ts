/** 将 QA 的规范二级路径转换成紧凑的人类可读形式。 */
export function formatTopicPath(value: string): string {
  const separator = value.indexOf(".");
  return separator < 0 ? value : `${value.slice(0, separator)} / ${value.slice(separator + 1)}`;
}
