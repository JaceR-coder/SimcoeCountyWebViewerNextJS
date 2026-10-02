import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";
import type { MyMapsItem, DrawType } from "@/stores/myMapsStore";

/**
 * Interface for MyMaps save data structure
 */
export interface MyMapsSaveData {
  items: MyMapsItem[];
  drawType: DrawType;
  drawColor: string;
}

/**
 * Interface for MyMaps database record
 */
export interface MyMapsRecord {
  id: string;
  json: string | null;
  date_created: Date | null;
  email: string | null;
  name: string | null;
  lastimported: Date | null;
  jsonhash: string | null;
}

/**
 * Compute SHA-256 hex hash of a JSON string.
 * Matches PostgreSQL: encode(digest(json, 'sha256'), 'hex')
 */
export function computeJsonHash(jsonString: string): string {
  return createHash("sha256").update(jsonString).digest("hex");
}

/**
 * Shared share-link store: web_search.tbl_mymaps in ner_master - the SAME table the legacy
 * SimcoeCountyWebViewer saves to (through py-Geomatics' /imap/mymaps and, before that, the Node
 * WebApi), so a My Maps ID saved in either app imports in the other. That table only has
 * id / json / date_created, so the public save/load path below uses raw SQL against it rather
 * than the tblMymaps Prisma model (NextJS's own public.tbl_mymaps, with email/name/jsonhash/
 * lastimported), which only the NextAuth named-map routes (upsertByNameAndUser/getMyMapsByUser)
 * still use. Only ever INSERTs new rows here - existing legacy rows are never modified.
 */
type SharedRow = { id: string; json: string | null; date_created: Date | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toRecord = (row: SharedRow): MyMapsRecord => ({
  id: row.id,
  json: row.json,
  date_created: row.date_created,
  email: null,
  name: null,
  lastimported: null,
  jsonhash: row.json === null ? null : computeJsonHash(row.json),
});

/**
 * MyMaps data access layer
 */
export class MyMapsService {
  /**
   * Insert a new share-link record into the shared legacy table (see SharedRow above).
   * email/name are accepted for signature compatibility but that table has no columns for them.
   * @returns Promise resolving to the inserted record ID
   */
  static async insertMyMaps(json: MyMapsSaveData): Promise<string> {
    const jsonString = JSON.stringify(json);
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO web_search.tbl_mymaps (json, date_created)
      VALUES (${jsonString}, CURRENT_DATE)
      RETURNING id::text AS id`;
    return rows[0].id;
  }

  /**
   * Retrieve a share-link record by ID (saved by either app)
   */
  static async getMyMaps(id: string): Promise<MyMapsRecord | undefined> {
    // Not a UUID can't match, and would make the ::uuid cast throw
    if (!UUID_RE.test(id)) return undefined;
    const rows = await prisma.$queryRaw<SharedRow[]>`
      SELECT id::text AS id, json, date_created
      FROM web_search.tbl_mymaps
      WHERE id = ${id}::uuid`;
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  /**
   * Find an existing share-link record with byte-identical JSON, for public save deduplication.
   * The legacy table has no hash column, so the hash is computed in SQL - Postgres' sha256 over
   * the UTF-8 text matches computeJsonHash().
   */
  static async findByHash(hash: string): Promise<MyMapsRecord | undefined> {
    const rows = await prisma.$queryRaw<SharedRow[]>`
      SELECT id::text AS id, json, date_created
      FROM web_search.tbl_mymaps
      WHERE json IS NOT NULL AND encode(sha256(convert_to(json, 'UTF8')), 'hex') = ${hash}
      LIMIT 1`;
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  /**
   * Get all MyMaps records for a given user email.
   * Returns id, name, date_created, lastimported (no json blob for perf).
   */
  static async getMyMapsByUser(
    email: string
  ): Promise<
    Pick<MyMapsRecord, "id" | "name" | "date_created" | "lastimported">[]
  > {
    const records = await prisma.tblMymaps.findMany({
      where: { email },
      select: {
        id: true,
        name: true,
        date_created: true,
        lastimported: true,
      },
      orderBy: { date_created: "desc" },
    });

    return records;
  }

  /**
   * Upsert a MyMaps record by (email, name).
   * If a record with the same email+name exists, update it.
   * Otherwise, create a new record.
   * Returns the record ID.
   */
  static async upsertByNameAndUser(
    email: string,
    name: string,
    json: MyMapsSaveData
  ): Promise<string> {
    const jsonString = JSON.stringify(json);
    const jsonhash = computeJsonHash(jsonString);

    const record = await prisma.tblMymaps.upsert({
      where: {
        email_name: { email, name },
      },
      update: {
        json: jsonString,
        jsonhash,
        date_created: new Date(),
      },
      create: {
        json: jsonString,
        jsonhash,
        email,
        name,
        date_created: new Date(),
      },
    });

    return record.id;
  }

  /**
   * Was: update lastimported. The shared legacy table has no such column, so this is a no-op kept
   * so callers (the public [id] route) don't need to change.
   */
  static async updateLastImported(_id: string): Promise<void> {
    void _id;
  }
}
