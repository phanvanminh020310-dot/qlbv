/** Metadata exposed by the guarded SQL Console schema endpoint. */
export interface SqlSchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  primaryKey: boolean;
}

export interface SqlSchemaForeignKey {
  name: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
  onUpdate: string;
  onDelete: string;
}

export interface SqlSchemaTable {
  name: string;
  columns: SqlSchemaColumn[];
  primaryKey: string[];
  foreignKeys: SqlSchemaForeignKey[];
}

export interface SqlSchemaResponse { tables: SqlSchemaTable[] }

/** Short, deliberate set; table and column names come from the live schema. */
export const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'ON', 'AS',
  'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'COUNT(*)',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'AND', 'OR', 'NULL',
  'IS NULL', 'ILIKE', 'IN', 'EXISTS', 'WITH', 'EXPLAIN',
] as const;
