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
            SELECT v.* FROM valuations v
            JOIN items i ON i.id = v.item_id
            WHERE v.item_id = $1 AND EXISTS (
                SELECT 1 FROM collection_members cm
                WHERE cm.collection_id = i.collection_id AND cm.user_id = $2
            )
            ORDER BY valuation_date DESC, recorded_timestamp DESC;
        `;
        const result = await sql.query(query, [itemId, userId]);
        return result;
    }

    // 3. Correct (update) an existing valuation estimate
    static async updateValuation(valuationId, amount, valuation_date, note, userId) {
        const query = `
            UPDATE valuations v
            SET amount = COALESCE($1, amount),
                valuation_date = COALESCE($2, valuation_date),
                note = COALESCE($3, note)
            WHERE v.id = $4 AND EXISTS (
                SELECT 1 FROM items i
                JOIN collection_members cm ON cm.collection_id = i.collection_id
                WHERE i.id = v.item_id AND cm.user_id = $5 AND cm.role = 'owner'
            )
            RETURNING *;
        `;
        const values = [amount ?? null, valuation_date ?? null, note ?? null, valuationId, userId];
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

    // 5. Generate collection valuation report (Totals, unvalued count, category breakdown, latest dates)
    static async getCollectionReport(collectionId, userId) {
        // CTE to get only the latest valuation per item in this collection
        const summaryQuery = `
            WITH latest_valuations AS (
                SELECT DISTINCT ON (v.item_id)
                    v.item_id,
                    v.amount,
                    v.valuation_date
                FROM valuations v
                JOIN items i ON v.item_id = i.id
                WHERE i.collection_id = $1 AND i.is_archived = FALSE
                ORDER BY v.item_id, v.valuation_date DESC, v.recorded_timestamp DESC
            )
            SELECT
                COALESCE(SUM(lv.amount), 0)::NUMERIC(12, 2) AS total_collection_value,
                COUNT(i.id)::INT AS total_items,
                COUNT(lv.item_id)::INT AS valued_items_count,
                (COUNT(i.id) - COUNT(lv.item_id))::INT AS unvalued_items_count
            FROM items i
            LEFT JOIN latest_valuations lv ON i.id = lv.item_id
            WHERE i.collection_id = $1 AND i.is_archived = FALSE
            HAVING EXISTS (
                SELECT 1 FROM collection_members cm
                WHERE cm.collection_id = $1 AND cm.user_id = $2
            );
        `;

        const categoryQuery = `
            WITH latest_valuations AS (
                SELECT DISTINCT ON (v.item_id)
                    v.item_id,
                    v.amount,
                    v.valuation_date
                FROM valuations v
                JOIN items i ON v.item_id = i.id
                WHERE i.collection_id = $1 AND i.is_archived = FALSE
                ORDER BY v.item_id, v.valuation_date DESC, v.recorded_timestamp DESC
            )
            SELECT
                i.category,
                COUNT(i.id)::INT AS item_count,
                COALESCE(SUM(lv.amount), 0)::NUMERIC(12, 2) AS category_total_value,
                MAX(lv.valuation_date) AS latest_valuation_date
            FROM items i
            LEFT JOIN latest_valuations lv ON i.id = lv.item_id
            WHERE i.collection_id = $1 AND i.is_archived = FALSE
            AND EXISTS (
                SELECT 1 FROM collection_members cm
                WHERE cm.collection_id = $1 AND cm.user_id = $2
            )
            GROUP BY i.category
            ORDER BY category_total_value DESC;
        `;

        const [summaryResult, categoryResult] = await Promise.all([
            sql.query(summaryQuery, [collectionId, userId]),
            sql.query(categoryQuery, [collectionId, userId])
        ]);

        if (!summaryResult.length) return undefined;

        return {
            summary: summaryResult[0],
            category_breakdown: categoryResult
        };
    }
}

module.exports = ValuationService;
