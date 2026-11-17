const ValuationService = require('../services/valuationService');

class ValuationController {
    // Add a new valuation entry
    static async addValuation(req, res) {
        try {
            const { itemId } = req.params;
            const { amount, valuation_date, note } = req.body ?? {};

            if (amount === undefined || amount < 0 || !valuation_date) {
                return res.status(400).json({
                    error: {
                        code: "VALIDATION_ERROR",
                        message: "Valid non-negative amount and valuation_date are required."
                    }
                });
            }

            const newValuation = await ValuationService.addValuation(itemId, amount, valuation_date, note, req.user.userId);
            if (!newValuation) {
                return res.status(404).json({ error: { code: "ITEM_NOT_FOUND", message: "Writable item not found." } });
            }
            return res.status(201).json({
                message: "Valuation recorded successfully",
                valuation: newValuation
            });
        } catch (error) {
            console.error("Error adding valuation:", error);
            if (error.code === '23503') {
                return res.status(404).json({
                    error: {
                        code: "ITEM_NOT_FOUND",
                        message: "The specified item does not exist."
                    }
                });
            }
            return res.status(500).json({
                error: {
                    code: "SERVER_ERROR",
                    message: "Internal server error"
                }
            });
        }
    }

    // Fetch valuation history for a specific item
    static async getItemValuations(req, res) {
        try {
            const { itemId } = req.params;
            const valuations = await ValuationService.getItemValuations(itemId, req.user.userId);

            return res.status(200).json({
                valuations
            });
        } catch (error) {
            console.error("Error fetching item valuations:", error);
            return res.status(500).json({
                error: {
                    code: "SERVER_ERROR",
                    message: "Internal server error"
                }
            });
        }
    }

    // Correct (update) an existing valuation
    static async updateValuation(req, res) {
        try {
            const { id } = req.params;
            const { amount, valuation_date, note } = req.body ?? {};

            if (amount !== undefined && amount < 0) {
                return res.status(400).json({
                    error: {
                        code: "VALIDATION_ERROR",
                        message: "Amount must be non-negative."
                    }
                });
            }

            const updatedValuation = await ValuationService.updateValuation(id, amount, valuation_date, note, req.user.userId);
            if (!updatedValuation) {
                return res.status(404).json({
                    error: {
                        code: "VALUATION_NOT_FOUND",
                        message: "Valuation entry not found."
                    }
                });
            }

            return res.status(200).json({
                message: "Valuation updated successfully",
                valuation: updatedValuation
            });
        } catch (error) {
            console.error("Error updating valuation:", error);
            return res.status(500).json({
                error: {
                    code: "SERVER_ERROR",
                    message: "Internal server error"
                }
            });
        }
    }

    // Delete a valuation entry
    static async deleteValuation(req, res) {
        try {
            const { id } = req.params;
            const deletedValuation = await ValuationService.deleteValuation(id, req.user.userId);

            if (!deletedValuation) {
                return res.status(404).json({
                    error: {
                        code: "VALUATION_NOT_FOUND",
                        message: "Valuation entry not found."
                    }
                });
            }

            return res.status(200).json({
                message: "Valuation deleted successfully",
                valuation: deletedValuation
            });
        } catch (error) {
            console.error("Error deleting valuation:", error);
            return res.status(500).json({
                error: {
                    code: "SERVER_ERROR",
                    message: "Internal server error"
                }
            });
        }
    }

    // Generate collection valuation report
    static async getCollectionReport(req, res) {
        try {
            const { collectionId } = req.params;
            const report = await ValuationService.getCollectionReport(collectionId, req.user.userId);
            if (!report) {
                return res.status(404).json({ error: { code: "COLLECTION_NOT_FOUND", message: "Collection not found." } });
            }

            return res.status(200).json({
                collection_id: collectionId,
                ...report
            });
        } catch (error) {
            console.error("Error generating collection report:", error);
            return res.status(500).json({
                error: {
                    code: "SERVER_ERROR",
                    message: "Internal server error"
                }
            });
        }
    }
}

module.exports = ValuationController;