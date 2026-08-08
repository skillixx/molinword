export const aiHistoryIndexName = "idx_ai_logs_user_id";
export const aiHistoryIndexColumns = Object.freeze(["user_id", "id"]);

export function hasExactMysqlIndex(indexRows, indexName, expectedColumns) {
  // 中文注解：索引同名不代表结构正确；按 MySQL 序号重建列序后精确比较，防止错误索引绕过迁移与就绪门禁。
  const actualColumns = indexRows
    .filter((row) => String(row.INDEX_NAME || "") === indexName)
    .sort((left, right) => Number(left.SEQ_IN_INDEX) - Number(right.SEQ_IN_INDEX))
    .map((row) => row.SUB_PART == null ? String(row.COLUMN_NAME || "") : "");
  return actualColumns.length === expectedColumns.length
    && actualColumns.every((columnName, index) => columnName === expectedColumns[index]);
}
