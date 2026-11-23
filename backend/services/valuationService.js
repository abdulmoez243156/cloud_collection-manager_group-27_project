const sql = require('../db/db');

class ValuationService {
    // 1. Record a new dated valuation estimate for an item
    static async addValuation(itemId, amount, valuation_date, note, userId) {
        const query = `
            INSERT INTO valuations (item_id, amount, valuation_date, note)
            SELECT i.id, $2, $3, $4
            FROM items i
            WHERE i.id = $1 AND EXISTS (
                SELECT 1 FROM collection_members cm
                WHERE cm.collection_id = i.collection_id AND cm.user_id = $5 AND cm.role = 'owner'
            )
            RETURNING *;
        `;
        const values = [itemId, amount, valuation_date, note ?? null, userId];
        const result = await sql.query(query, values);
        return result[0];
    }

    // 2. Retrieve valuation history for a specific item
    static async getItemValuations(itemId, userId) {
        const query = `
            SELECT v.*
            FROM items i
            JOIN collection_members cm ON cm.collection_id = i.collection_id
            LEFT JOIN valuations v ON v.item_id = i.id
            WHERE i.id = $1 AND cm.user_id = $2
            ORDER BY v.valuation_date DESC, v.recorded_timestamp DESC, v.id DESC;
        `;
        const result = await sql.query(query, [itemId, userId]);
        // A member can see an item with no history. Missing and private items return no rows.
        if (!result.length) return undefined;
        return result[0].id === null ? [] : result;
    }

    // Correct only the supplied fields, within the caller's owned collection.
    static async updateValuation(valuationId, fields, userId) {
        const query = `
            UPDATE valuations v
            SET amount = COALESCE($1, v.amount),
                valuation_date = COALESCE($2, v.valuation_date),
                note = CASE WHEN $3::boolean THEN $4 ELSE v.note END
            WHERE v.id = $5 AND EXISTS (
                SELECT 1 FROM items i
                JOIN collection_members cm ON cm.collection_id = i.collection_id
                WHERE i.id = v.item_id AND cm.user_id = $6 AND cm.role = 'owner'
            )
            RETURNING *;
        `;
        const values = [
            fields.amount ?? null, fields.valuation_date ?? null, Object.hasOwn(fields, 'note'),
            fields.note ?? null, valuationId, userId
        ];
        const result = await sql.query(query, values);
        return result[0];
    }

    // 4. Delete a valuation estimate
    static async deleteValuation(valuationId, userId) {
        const query = `
            DELETE FROM valuations v
            WHERE v.id = $1 AND EXISTS (
                SELECT 1 FROM items i
                JOIN collection_members cm ON cm.collection_id = i.collection_id
                WHERE i.id = v.item_id AND cm.user_id = $2 AND cm.role = 'owner'
            )
            RETURNING *;
        `;
        const result = await sql.query(query, [valuationId, userId]);
        return result[0];
    }

    static async getCollectionReport(collectionId, userId) {
        // Both report sections use the same active items and latest valuations in one snapshot.
        const query = `
            WITH member_collection AS (
                SELECT c.id, c.currency
                FROM collections c
                JOIN collection_members cm ON cm.collection_id = c.id
                WHERE c.id = $1 AND cm.user_id = $2
            ), active_items AS (
                SELECT i.id, i.category
                FROM items i
                JOIN member_collection c ON c.id = i.collection_id
                WHERE i.is_archived = FALSE
            ), latest_valuations AS (
                SELECT DISTINCT ON (v.item_id)
                    v.item_id, v.amount, v.valuation_date
                FROM valuations v
                JOIN active_items i ON i.id = v.item_id
                ORDER BY v.item_id, v.valuation_date DESC, v.recorded_timestamp DESC, v.id DESC
            ), totals AS (
                SELECT
                    GROUPING(i.category) = 1 AS is_summary,
                    i.category,
                    COUNT(*)::INT AS item_count,
                    COUNT(lv.item_id)::INT AS valued_items_count,
                    COUNT(*) FILTER (WHERE lv.item_id IS NULL)::INT AS unvalued_items_count,
                    COALESCE(SUM(lv.amount), 0.00) AS total_value,
                    MAX(lv.valuation_date) AS latest_valuation_date
                FROM active_items i
                LEFT JOIN latest_valuations lv ON lv.item_id = i.id
                GROUP BY GROUPING SETS ((), (i.category))
            )
            SELECT t.*, c.currency
            FROM totals t
            CROSS JOIN member_collection c
            ORDER BY t.is_summary DESC, t.total_value DESC, t.category;
        `;
        const [overall, ...categories] = await sql.query(query, [collectionId, userId]);
        if (!overall) return undefined;

        return {
            currency: overall.currency,
            summary: {
                total_collection_value: overall.total_value,
                total_items: overall.item_count,
                valued_items_count: overall.valued_items_count,
                unvalued_items_count: overall.unvalued_items_count,
                latest_valuation_date: overall.latest_valuation_date
            },
            category_breakdown: categories.map(row => ({
                category: row.category,
                item_count: row.item_count,
                valued_items_count: row.valued_items_count,
                unvalued_items_count: row.unvalued_items_count,
                category_total_value: row.total_value,
                latest_valuation_date: row.latest_valuation_date
            }))
        };
    }
}

module.exports = ValuationService;
